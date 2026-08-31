#!/usr/bin/env python3
"""Normalize the photographed Prose Poem Tarot into an 80-card web catalog.

The source folder is read in filename order.  It contains the standard 78-card
deck plus alternate Hierophant and Ten of Swords artworks.  Every photograph is
measured independently against the physical rounded card edge, perspective
corrected to 640x1120, and given one shared RGBA corner mask.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from process_redvisions_assets import (
    Line,
    _line_score_horizontal,
    _line_score_vertical,
    gradient_maps,
    intersect,
    rectify,
    save_diagnostic,
)


CARD_COUNT = 80
OUTPUT_SIZE = (640, 1120)
THUMB_SIZE = (240, 420)
OUTPUT_CORNER_RADIUS = 28

# S__42803289_0.jpg has a particularly crisp, nearly axis-aligned physical
# outline.  This calibration was measured from Prose Poem itself; it is not the
# fixed quadrilateral used by The Unveiled Tarot.
REFERENCE_CARD_INDEX = 60
REFERENCE_SOURCE_NAME = "S__42803289_0.jpg"
REFERENCE_SOURCE_SIZE = (1774, 2364)
REFERENCE_QUAD = np.array(
    [
        [228.37151539306603, 67.97376666666668],
        [1543.5761524792538, 67.97376666666668],
        [1528.3549013158204, 2292.6181674761615],
        [220.7761931909666, 2288.144871895735],
    ],
    dtype=np.float64,
)
REFERENCE_PROJECTED_RATIO = 0.5900700717420576
MAX_RATIO_DELTA = 0.025
RECOVERY_RATIO_DELTA = 0.010


MAJOR_ARCANA = [
    ("The Fool", "愚者", "0"),
    ("The Magician", "魔術師", "I"),
    ("The High Priestess", "女祭司", "II"),
    ("The Empress", "皇后", "III"),
    ("The Emperor", "皇帝", "IV"),
    ("The Hierophant A", "教皇 A", "V-A"),
    ("The Hierophant B", "教皇 B", "V-B"),
    ("The Lovers", "戀人", "VI"),
    ("The Chariot", "戰車", "VII"),
    ("Strength", "力量", "VIII"),
    ("The Hermit", "隱者", "IX"),
    ("Wheel of Fortune", "命運之輪", "X"),
    ("Justice", "正義", "XI"),
    ("The Hanged Man", "倒吊人", "XII"),
    ("Death", "死神", "XIII"),
    ("Temperance", "節制", "XIV"),
    ("The Devil", "惡魔", "XV"),
    ("The Tower", "高塔", "XVI"),
    ("The Star", "星星", "XVII"),
    ("The Moon", "月亮", "XVIII"),
    ("The Sun", "太陽", "XIX"),
    ("Judgement", "審判", "XX"),
    ("The World", "世界", "XXI"),
]

CARD_NAMES = [
    (name, name_zh, "Major Arcana", numeral)
    for name, name_zh, numeral in MAJOR_ARCANA
]

RANKS = [
    ("Ace", "一"),
    ("2", "二"),
    ("3", "三"),
    ("4", "四"),
    ("5", "五"),
    ("6", "六"),
    ("7", "七"),
    ("8", "八"),
    ("9", "九"),
    ("10", "十"),
    ("Page", "侍者"),
    ("Knight", "騎士"),
    ("Queen", "皇后"),
    ("King", "國王"),
]

for suit, suit_zh in [("Wands", "權杖"), ("Cups", "聖杯")]:
    for rank, rank_zh in RANKS:
        CARD_NAMES.append(
            (f"{rank} of {suit}", f"{suit_zh}{rank_zh}", suit, rank)
        )

for rank, rank_zh in RANKS[:9]:
    CARD_NAMES.append((f"{rank} of Swords", f"寶劍{rank_zh}", "Swords", rank))
CARD_NAMES.extend(
    [
        ("10 of Swords A", "寶劍十 A", "Swords", "10-A"),
        ("10 of Swords B", "寶劍十 B", "Swords", "10-B"),
    ]
)
for rank, rank_zh in RANKS[10:]:
    CARD_NAMES.append((f"{rank} of Swords", f"寶劍{rank_zh}", "Swords", rank))

for rank, rank_zh in RANKS:
    CARD_NAMES.append(
        (f"{rank} of Pentacles", f"錢幣{rank_zh}", "Pentacles", rank)
    )

if len(CARD_NAMES) != CARD_COUNT:
    raise RuntimeError(f"Prose Poem card map must contain {CARD_COUNT} entries")


def source_files(source: Path) -> list[Path]:
    """Return exactly 80 face photographs in case-insensitive filename order."""
    if not source.is_dir():
        raise RuntimeError(f"Prose Poem source folder does not exist: {source}")
    files = sorted(
        (
            path
            for path in source.iterdir()
            if path.is_file() and path.suffix.casefold() in {".jpg", ".jpeg"}
        ),
        key=lambda path: path.name.casefold(),
    )
    if len(files) != CARD_COUNT:
        raise RuntimeError(
            f"Prose Poem source must contain exactly {CARD_COUNT} JPG files; "
            f"found {len(files)}"
        )
    return files


def select_separated_candidates(scored: list[Line], limit: int = 64) -> list[Line]:
    """Keep distinct long-edge hypotheses instead of only the strongest art line."""
    selected: list[Line] = []
    for line in sorted(scored, key=lambda candidate: candidate.score, reverse=True):
        if any(abs(line.intercept - kept.intercept) < 2.25 for kept in selected):
            continue
        selected.append(line)
        if len(selected) == limit:
            break
    return selected


def vertical_candidates(gradient: np.ndarray, side: str) -> list[Line]:
    height, width = gradient.shape
    y0, y1 = int(0.10 * height), int(0.90 * height)
    if side == "left":
        intercepts = np.linspace(0.055 * width, 0.30 * width, 220)
    elif side == "right":
        intercepts = np.linspace(0.70 * width, 0.93 * width, 220)
    else:
        raise ValueError(f"unknown vertical side: {side}")
    # Bounds and slopes stay far enough from the downsampled image edge for the
    # inherited three-pixel gradient sampler to remain in-bounds.
    slopes = np.linspace(-0.065, 0.065, 41)
    scored: list[Line] = []
    for intercept in intercepts:
        best = Line(0.0, float(intercept), -1.0)
        for slope in slopes:
            score = _line_score_vertical(
                gradient, float(slope), float(intercept), y0, y1
            )
            if score > best.score:
                best = Line(float(slope), float(intercept), score)
        scored.append(best)
    return select_separated_candidates(scored)


def horizontal_candidates(gradient: np.ndarray, side: str) -> list[Line]:
    height, width = gradient.shape
    x0, x1 = int(0.15 * width), int(0.85 * width)
    if side == "top":
        intercepts = np.linspace(0.02 * height, 0.20 * height, 220)
    elif side == "bottom":
        intercepts = np.linspace(0.80 * height, 0.98 * height, 220)
    else:
        raise ValueError(f"unknown horizontal side: {side}")
    slopes = np.linspace(-0.05, 0.05, 41)
    scored: list[Line] = []
    for intercept in intercepts:
        best = Line(0.0, float(intercept), -1.0)
        for slope in slopes:
            score = _line_score_horizontal(
                gradient, float(slope), float(intercept), x0, x1
            )
            if score > best.score:
                best = Line(float(slope), float(intercept), score)
        scored.append(best)
    return select_separated_candidates(scored)


def foreground_profiles(image: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    """Locate the coloured card against this deck's neutral woven backdrop."""
    rgb = np.asarray(image, dtype=np.float64)
    height, width = rgb.shape[:2]
    sample_mask = np.zeros((height, width), dtype=bool)
    side_width = max(4, int(0.025 * width))
    corner_height = max(4, int(0.045 * height))
    corner_width = max(4, int(0.18 * width))
    sample_mask[:, :side_width] = True
    sample_mask[:, width - side_width :] = True
    sample_mask[:corner_height, :corner_width] = True
    sample_mask[:corner_height, width - corner_width :] = True
    sample_mask[height - corner_height :, :corner_width] = True
    sample_mask[height - corner_height :, width - corner_width :] = True

    background = rgb[sample_mask]
    mean = background.mean(axis=0)
    covariance = np.cov(background.T) + np.eye(3) * 25.0
    inverse = np.linalg.pinv(covariance)
    delta = rgb - mean
    distance = np.sqrt(np.einsum("...i,ij,...j->...", delta, inverse, delta))
    foreground = distance > 3.0
    row_profile = foreground[
        :, int(0.16 * width) : int(0.84 * width)
    ].mean(axis=1)
    column_profile = foreground[
        int(0.10 * height) : int(0.90 * height), :
    ].mean(axis=0)
    return row_profile, column_profile


def sustained_bounds(
    profile: np.ndarray, threshold: float = 0.40, run: int = 5
) -> tuple[int | None, int | None]:
    active = np.asarray(profile >= threshold, dtype=np.int16)
    if active.size < run:
        return None, None
    sustained = np.convolve(active, np.ones(run, dtype=np.int16), mode="valid") == run
    starts = np.flatnonzero(sustained)
    if starts.size == 0:
        return None, None
    return int(starts[0]), int(starts[-1] + run - 1)


def candidate_near_profile(
    candidates: list[Line],
    predicted: int | None,
    low: float,
    high: float,
    side: str,
) -> tuple[Line, str, float | None]:
    allowed = [candidate for candidate in candidates if low <= candidate.intercept <= high]
    if not allowed:
        raise RuntimeError(f"no {side} edge candidates in the physical boundary band")
    strongest = max(candidate.score for candidate in allowed)
    score_floor = max(0.006, strongest * 0.08)
    eligible = [candidate for candidate in allowed if candidate.score >= score_floor]
    if predicted is not None and low <= predicted <= high:
        nearest = min(
            eligible,
            key=lambda candidate: (abs(candidate.intercept - predicted), -candidate.score),
        )
        distance = abs(nearest.intercept - predicted)
        if distance <= 18.0:
            return nearest, "profile", float(distance)

    ordered = sorted(eligible, key=lambda candidate: candidate.intercept)
    line = ordered[0] if side in {"left", "top"} else ordered[-1]
    return line, "outer-fallback", None


def quad_measurements(quad: np.ndarray):
    widths = [
        np.linalg.norm(quad[1] - quad[0]),
        np.linalg.norm(quad[2] - quad[3]),
    ]
    heights = [
        np.linalg.norm(quad[3] - quad[0]),
        np.linalg.norm(quad[2] - quad[1]),
    ]
    ratio = float(np.mean(widths) / np.mean(heights))
    return widths, heights, ratio


def recover_vertical_edges(
    left_candidates: list[Line],
    right_candidates: list[Line],
    top: Line,
    bottom: Line,
    width: int,
    height: int,
) -> tuple[Line, Line, dict] | None:
    """Recover pale physical sides when artwork fooled the colour profile.

    The ordinary path remains profile-led.  This fallback only considers line
    candidates measured in the current photograph and requires their projected
    outline to agree closely with this deck's calibrated physical aspect ratio.
    It therefore corrects an inner illustration edge without substituting a
    shared quadrilateral from another card.
    """
    options = []
    coordinate_margin = 0.025 * max(width, height)
    for left in left_candidates:
        for right in right_candidates:
            quad = np.array(
                [
                    intersect(left, top, width, height),
                    intersect(right, top, width, height),
                    intersect(right, bottom, width, height),
                    intersect(left, bottom, width, height),
                ]
            )
            widths, heights, ratio = quad_measurements(quad)
            ratio_delta = abs(ratio - REFERENCE_PROJECTED_RATIO)
            inside = bool(
                np.all(quad[:, 0] >= -coordinate_margin)
                and np.all(quad[:, 0] <= width - 1 + coordinate_margin)
                and np.all(quad[:, 1] >= -coordinate_margin)
                and np.all(quad[:, 1] <= height - 1 + coordinate_margin)
            )
            if (
                ratio_delta > RECOVERY_RATIO_DELTA
                or min(widths) <= width * 0.55
                or min(heights) <= height * 0.78
                or min(left.score, right.score, top.score, bottom.score) <= 0.006
                or not inside
            ):
                continue
            edge_strength = left.score + right.score
            options.append((edge_strength, -ratio_delta, left, right, ratio))

    if not options:
        return None
    edge_strength, negative_delta, left, right, ratio = max(
        options, key=lambda option: (option[0], option[1])
    )
    return left, right, {
        "method": "ratio-recovery",
        "ratio": float(ratio),
        "ratioDelta": float(-negative_delta),
        "edgeStrength": float(edge_strength),
    }


def scaled_reference_quad(image: Image.Image) -> np.ndarray:
    scale = np.array(
        [image.width / REFERENCE_SOURCE_SIZE[0], image.height / REFERENCE_SOURCE_SIZE[1]],
        dtype=np.float64,
    )
    return REFERENCE_QUAD * scale


def detect_prosepoem_quad(image: Image.Image, use_reference: bool = False):
    """Detect this photograph's four physical edges and report geometry quality."""
    if use_reference:
        quad = scaled_reference_quad(image)
        widths, heights, ratio = quad_measurements(quad)
        metrics = {
            "ratio": ratio,
            "targetRatio": REFERENCE_PROJECTED_RATIO,
            "ratioDelta": abs(ratio - REFERENCE_PROJECTED_RATIO),
            "confidence": 1.0,
            "valid": True,
            "referenceCard": REFERENCE_CARD_INDEX,
            "widths": [float(value) for value in widths],
            "heights": [float(value) for value in heights],
            "widthRatio": float(np.mean(widths) / image.width),
            "heightRatio": float(np.mean(heights) / image.height),
            "profileBounds": None,
            "selection": {"calibration": REFERENCE_SOURCE_NAME},
            "scale": 1.0,
        }
        return quad, {"calibration": REFERENCE_SOURCE_NAME}, metrics

    small, gradient_x, gradient_y, scale = gradient_maps(image)
    width, height = small.size
    row_profile, column_profile = foreground_profiles(small)
    top_profile, bottom_profile = sustained_bounds(row_profile)
    left_profile, right_profile = sustained_bounds(column_profile)
    profile_bounds = {
        "top": top_profile,
        "right": right_profile,
        "bottom": bottom_profile,
        "left": left_profile,
    }

    left_candidates = vertical_candidates(gradient_x, "left")
    right_candidates = vertical_candidates(gradient_x, "right")
    top_candidates = horizontal_candidates(gradient_y, "top")
    bottom_candidates = horizontal_candidates(gradient_y, "bottom")
    left, left_method, left_distance = candidate_near_profile(
        left_candidates,
        left_profile,
        0.055 * width,
        0.30 * width,
        "left",
    )
    right, right_method, right_distance = candidate_near_profile(
        right_candidates,
        right_profile,
        0.70 * width,
        0.93 * width,
        "right",
    )
    top, top_method, top_distance = candidate_near_profile(
        top_candidates,
        top_profile,
        0.02 * height,
        0.20 * height,
        "top",
    )
    bottom, bottom_method, bottom_distance = candidate_near_profile(
        bottom_candidates,
        bottom_profile,
        0.80 * height,
        0.98 * height,
        "bottom",
    )

    quad_small = np.array(
        [
            intersect(left, top, width, height),
            intersect(right, top, width, height),
            intersect(right, bottom, width, height),
            intersect(left, bottom, width, height),
        ]
    )
    _, _, initial_ratio = quad_measurements(quad_small)
    recovery = None
    if abs(initial_ratio - REFERENCE_PROJECTED_RATIO) > MAX_RATIO_DELTA:
        recovered = recover_vertical_edges(
            left_candidates,
            right_candidates,
            top,
            bottom,
            width,
            height,
        )
        if recovered is not None:
            left, right, recovery = recovered
            left_method = right_method = "ratio-recovery"
            left_distance = right_distance = None
            quad_small = np.array(
                [
                    intersect(left, top, width, height),
                    intersect(right, top, width, height),
                    intersect(right, bottom, width, height),
                    intersect(left, bottom, width, height),
                ]
            )
    quad = quad_small / scale
    widths, heights, ratio = quad_measurements(quad)
    mean_width = float(np.mean(widths))
    mean_height = float(np.mean(heights))
    confidence = float(min(left.score, right.score, top.score, bottom.score))
    ratio_delta = abs(ratio - REFERENCE_PROJECTED_RATIO)
    profile_complete = all(value is not None for value in profile_bounds.values())
    coordinate_margin = 0.025 * max(image.size)
    inside_source = bool(
        np.all(quad[:, 0] >= -coordinate_margin)
        and np.all(quad[:, 0] <= image.width - 1 + coordinate_margin)
        and np.all(quad[:, 1] >= -coordinate_margin)
        and np.all(quad[:, 1] <= image.height - 1 + coordinate_margin)
    )
    valid = bool(
        profile_complete
        and ratio_delta <= MAX_RATIO_DELTA
        and min(widths) > image.width * 0.55
        and min(heights) > image.height * 0.78
        and confidence > 0.006
        and inside_source
    )
    lines = {
        "left": left.__dict__,
        "right": right.__dict__,
        "top": top.__dict__,
        "bottom": bottom.__dict__,
    }
    metrics = {
        "ratio": ratio,
        "targetRatio": REFERENCE_PROJECTED_RATIO,
        "ratioDelta": ratio_delta,
        "confidence": confidence,
        "valid": valid,
        "referenceCard": REFERENCE_CARD_INDEX,
        "widths": [float(value) for value in widths],
        "heights": [float(value) for value in heights],
        "widthRatio": mean_width / image.width,
        "heightRatio": mean_height / image.height,
        "profileBounds": profile_bounds,
        "selection": {
            "left": {"method": left_method, "distance": left_distance},
            "right": {"method": right_method, "distance": right_distance},
            "top": {"method": top_method, "distance": top_distance},
            "bottom": {"method": bottom_method, "distance": bottom_distance},
            "recovery": recovery,
        },
        "scale": scale,
    }
    return quad, lines, metrics


def rounded_mask(size: tuple[int, int], radius: int = OUTPUT_CORNER_RADIUS) -> Image.Image:
    """Build the one antialiased mask shared by every face and the card back."""
    width, height = size
    supersample = 4
    mask = Image.new("L", (width * supersample, height * supersample), 0)
    draw = ImageDraw.Draw(mask)
    edge_inset = supersample
    draw.rounded_rectangle(
        (
            edge_inset,
            edge_inset,
            width * supersample - edge_inset - 1,
            height * supersample - edge_inset - 1,
        ),
        radius=radius * supersample,
        fill=255,
    )
    return mask.resize(size, Image.Resampling.LANCZOS)


def apply_rounded_alpha(image: Image.Image) -> Image.Image:
    output = image.convert("RGBA")
    output.putalpha(rounded_mask(output.size))
    return output


def report_entry(
    index: int | None,
    source: Path,
    quad: np.ndarray,
    lines: dict,
    metrics: dict,
) -> dict:
    entry = {
        "source": source.name,
        "quad": [[round(float(x), 2), round(float(y), 2)] for x, y in quad],
        "lines": lines,
        "metrics": metrics,
    }
    if index is not None:
        entry["index"] = index
    return entry


def process_card_back(
    source: Path, target: Path, diagnostic_target: Path
) -> dict:
    if not source.is_file():
        raise RuntimeError(f"Prose Poem card back does not exist: {source}")
    with Image.open(source) as source_image:
        artwork = source_image.convert("RGB")
    quad, lines, metrics = detect_prosepoem_quad(artwork)
    output = apply_rounded_alpha(rectify(artwork, quad, size=OUTPUT_SIZE))
    target.parent.mkdir(parents=True, exist_ok=True)
    output.save(target, "WEBP", quality=91, method=6)
    save_diagnostic(
        artwork,
        quad,
        diagnostic_target,
        "Prose Poem Tarot — card back",
        bool(metrics["valid"]),
    )
    return report_entry(None, source, quad, lines, metrics)


def make_contact_sheet(card_dir: Path, target: Path) -> None:
    columns, rows = 10, 8
    thumb_width, thumb_height = 96, 168
    gap, label_height = 8, 24
    sheet = Image.new(
        "RGB",
        (
            gap + columns * (thumb_width + gap),
            gap + rows * (thumb_height + label_height + gap),
        ),
        "#151515",
    )
    draw = ImageDraw.Draw(sheet)
    for index, (name, _, _, _) in enumerate(CARD_NAMES):
        with Image.open(card_dir / f"card-{index:02d}.webp") as image:
            preview = image.convert("RGBA")
            preview.thumbnail((thumb_width, thumb_height), Image.Resampling.LANCZOS)
        row, column = divmod(index, columns)
        x = gap + column * (thumb_width + gap)
        y = gap + row * (thumb_height + label_height + gap)
        sheet.paste(preview, (x, y), preview)
        draw.text((x, y + thumb_height + 3), f"{index:02d} {name[:12]}", fill="#f4e8cf")
    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target, quality=92)


def write_manifest(output: Path) -> None:
    manifest = []
    for index, (name, name_zh, suit, rank) in enumerate(CARD_NAMES):
        manifest.append(
            {
                "index": index,
                "name": name,
                "nameZh": name_zh,
                "suit": suit,
                "rank": rank,
                "file": f"cards/card-{index:02d}.webp",
                "thumbnail": f"cards/thumbs/card-{index:02d}.webp",
            }
        )
    (output / "cards-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def selected_indices(samples: list[int] | None) -> list[int]:
    if samples is None:
        return list(range(CARD_COUNT))
    if len(samples) != len(set(samples)):
        raise RuntimeError("--samples cannot contain duplicate indices")
    invalid = [index for index in samples if not 0 <= index < CARD_COUNT]
    if invalid:
        raise RuntimeError(f"--samples indices must be 0 through 79; got {invalid}")
    return sorted(samples)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--back-source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--samples", nargs="*", type=int)
    args = parser.parse_args()

    files = source_files(args.source)
    indices = selected_indices(args.samples)
    full_run = indices == list(range(CARD_COUNT))
    card_dir = args.output / "cards"
    thumb_dir = card_dir / "thumbs"
    diagnostic_dir = args.work / "prosepoem-diagnostics"
    card_dir.mkdir(parents=True, exist_ok=True)
    thumb_dir.mkdir(parents=True, exist_ok=True)

    card_report = []
    for index in indices:
        source_path = files[index]
        with Image.open(source_path) as source_image:
            image = source_image.convert("RGB")
        use_reference = (
            index == REFERENCE_CARD_INDEX
            and source_path.name.casefold() == REFERENCE_SOURCE_NAME.casefold()
        )
        quad, lines, metrics = detect_prosepoem_quad(image, use_reference=use_reference)
        output = apply_rounded_alpha(rectify(image, quad, size=OUTPUT_SIZE))
        output.save(card_dir / f"card-{index:02d}.webp", "WEBP", quality=91, method=6)
        thumbnail = output.resize(THUMB_SIZE, Image.Resampling.LANCZOS)
        thumbnail.save(
            thumb_dir / f"card-{index:02d}.webp", "WEBP", quality=82, method=6
        )
        save_diagnostic(
            image,
            quad,
            diagnostic_dir / f"card-{index:02d}.jpg",
            f"{index:02d} {CARD_NAMES[index][0]}",
            bool(metrics["valid"]),
        )
        card_report.append(report_entry(index, source_path, quad, lines, metrics))
        print(
            f"{index:02d} {CARD_NAMES[index][0]:23} "
            f"ratio={metrics['ratio']:.4f} "
            f"delta={metrics['ratioDelta']:.4f} "
            f"conf={metrics['confidence']:.4f} "
            f"{'OK' if metrics['valid'] else 'CHECK'}"
        )

    back_report = process_card_back(
        args.back_source,
        args.output / "card-back.webp",
        diagnostic_dir / "card-back.jpg",
    )
    print(
        "BACK "
        f"ratio={back_report['metrics']['ratio']:.4f} "
        f"delta={back_report['metrics']['ratioDelta']:.4f} "
        f"conf={back_report['metrics']['confidence']:.4f} "
        f"{'OK' if back_report['metrics']['valid'] else 'CHECK'}"
    )

    detection_report = {
        "deck": "Prose Poem Tarot",
        "cardCount": CARD_COUNT,
        "run": "full" if full_run else "samples",
        "selectedIndices": indices,
        "outputSize": list(OUTPUT_SIZE),
        "thumbnailSize": list(THUMB_SIZE),
        "cornerRadius": OUTPUT_CORNER_RADIUS,
        "reference": {
            "index": REFERENCE_CARD_INDEX,
            "source": REFERENCE_SOURCE_NAME,
            "sourceSize": list(REFERENCE_SOURCE_SIZE),
            "quad": REFERENCE_QUAD.tolist(),
            "projectedRatio": REFERENCE_PROJECTED_RATIO,
            "maxRatioDelta": MAX_RATIO_DELTA,
        },
        "cards": card_report,
        "cardBack": back_report,
    }
    args.work.mkdir(parents=True, exist_ok=True)
    report_path = args.work / "prosepoem-detection.json"
    report_path.write_text(
        json.dumps(detection_report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    invalid = [
        entry["index"] for entry in card_report if not entry["metrics"]["valid"]
    ]
    if invalid or not back_report["metrics"]["valid"]:
        details = []
        if invalid:
            details.append(f"fronts={invalid}")
        if not back_report["metrics"]["valid"]:
            details.append("card-back")
        raise RuntimeError(
            "Unreliable Prose Poem physical-edge detection: " + ", ".join(details)
        )

    if full_run:
        write_manifest(args.output)
        make_contact_sheet(card_dir, args.work / "prosepoem-card-contact.jpg")


if __name__ == "__main__":
    main()
