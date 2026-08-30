#!/usr/bin/env python3
"""Normalize The Unveiled Tarot photographs into an 80-card web catalog.

The source folder is expected to contain the complete photographed deck in
filename order: 24 major arcana (including The Mob and The Puppeteer), followed
by the standard 56 minor arcana, plus a separately identified card-back photo.
Card detection and perspective correction
reuse the proven Red Visions pipeline so all published decks share the same
4:7 texture, thumbnail, diagnostic, and manifest conventions.
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


REFERENCE_CARD_INDEX = 7
REFERENCE_SOURCE_SIZE = (1774, 2364)
# Physical outer edge of card 07 (The Chariot), used without an inward crop.
# Every other photograph resolves its own physical outer edge, then publishes
# to this card's canvas geometry and four-corner silhouette.
REFERENCE_QUAD = np.array(
    [
        [279.7403530969685, 179.08879915033575],
        [1496.9964091844868, 194.84152458205656],
        [1476.98916366513, 2256.194093243004],
        [252.9626632748331, 2248.2739217698904],
    ],
    dtype=np.float64,
)
REFERENCE_PROJECTED_RATIO = 0.5910248261200236
OUTPUT_SIZE = (640, 1120)
OUTPUT_CORNER_RADIUS = 28


MAJOR_ARCANA = [
    ("The Fool", "愚者", "0"),
    ("The Magician", "魔術師", "I"),
    ("The High Priestess", "女祭司", "II"),
    ("The Empress", "皇后", "III"),
    ("The Emperor", "皇帝", "IV"),
    ("The Hierophant", "教皇", "V"),
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
    ("The Mob", "群眾", "XXII"),
    ("The Puppeteer", "傀儡師", "XXIII"),
]


CARD_NAMES = [
    (name, name_zh, "Major Arcana", numeral)
    for name, name_zh, numeral in MAJOR_ARCANA
]


def vertical_candidates(gradient: np.ndarray, side: str, limit: int = 48) -> list[Line]:
    """Return separated long-edge candidates, including weaker outer borders."""
    height, width = gradient.shape
    y0, y1 = int(0.12 * height), int(0.88 * height)
    if side == "left":
        intercepts = np.linspace(0.055 * width, 0.26 * width, 190)
    else:
        intercepts = np.linspace(0.74 * width, 0.945 * width, 190)
    slopes = np.linspace(-0.065, 0.065, 39)
    scored = []
    for intercept in intercepts:
        best = Line(0, float(intercept), -1)
        for slope in slopes:
            score = _line_score_vertical(
                gradient, float(slope), float(intercept), y0, y1
            )
            if score > best.score:
                best = Line(float(slope), float(intercept), score)
        scored.append(best)
    return select_separated_candidates(scored, limit)


def horizontal_candidates(gradient: np.ndarray, side: str, limit: int = 48) -> list[Line]:
    """Return outer-edge options so inner artwork lines cannot win by strength alone."""
    height, width = gradient.shape
    x0, x1 = int(0.18 * width), int(0.82 * width)
    if side == "top":
        intercepts = np.linspace(0.002 * height, 0.16 * height, 190)
    else:
        intercepts = np.linspace(0.86 * height, 0.998 * height, 190)
    slopes = np.linspace(-0.065, 0.065, 39)
    scored = []
    for intercept in intercepts:
        best = Line(0, float(intercept), -1)
        for slope in slopes:
            score = _line_score_horizontal(
                gradient, float(slope), float(intercept), x0, x1
            )
            if score > best.score:
                best = Line(float(slope), float(intercept), score)
        scored.append(best)
    return select_separated_candidates(scored, limit)


def select_separated_candidates(scored: list[Line], limit: int) -> list[Line]:
    """Non-maximum suppression keeps distinct physical and artwork edges."""
    selected = []
    for line in sorted(scored, key=lambda candidate: candidate.score, reverse=True):
        if any(abs(line.intercept - kept.intercept) < 2.5 for kept in selected):
            continue
        selected.append(line)
        if len(selected) == limit:
            break
    return selected


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


def scaled_reference_quad(image: Image.Image) -> np.ndarray:
    scale = np.array(
        [image.width / REFERENCE_SOURCE_SIZE[0], image.height / REFERENCE_SOURCE_SIZE[1]],
        dtype=np.float64,
    )
    return REFERENCE_QUAD * scale


def foreground_profiles(image: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    """Estimate where the central card stops matching the grey cloth backdrop."""
    rgb = np.asarray(image, dtype=np.float64)
    height, width = rgb.shape[:2]
    sample_mask = np.zeros((height, width), dtype=bool)
    side_width = max(4, int(0.025 * width))
    corner_height = max(4, int(0.04 * height))
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
    inverse = np.linalg.inv(covariance)
    delta = rgb - mean
    distance = np.sqrt(np.einsum("...i,ij,...j->...", delta, inverse, delta))
    foreground = distance > 3.0
    row_profile = foreground[
        :, int(0.18 * width) : int(0.82 * width)
    ].mean(axis=1)
    column_profile = foreground[
        int(0.12 * height) : int(0.88 * height), :
    ].mean(axis=0)
    return row_profile, column_profile


def sustained_bounds(
    profile: np.ndarray, threshold: float = 0.42, run: int = 5
) -> tuple[int | None, int | None]:
    active = np.asarray(profile >= threshold, dtype=np.int16)
    if active.size < run:
        return None, None
    sustained = np.convolve(active, np.ones(run, dtype=np.int16), mode="valid") == run
    starts = np.flatnonzero(sustained)
    if starts.size == 0:
        return None, None
    return int(starts[0]), int(starts[-1] + run - 1)


def candidate_in_range(
    candidates: list[Line], low: float, high: float
) -> list[Line]:
    return [candidate for candidate in candidates if low <= candidate.intercept <= high]


def candidate_near_profile(
    candidates: list[Line], predicted: int | None, low: float, high: float
) -> Line | None:
    if predicted is None or not low <= predicted <= high:
        return None
    allowed = candidate_in_range(candidates, low, high)
    if not allowed:
        return None
    nearest = min(allowed, key=lambda candidate: abs(candidate.intercept - predicted))
    strongest = max(candidate.score for candidate in allowed)
    if nearest.score < max(0.025, strongest * 0.16):
        return None
    return nearest


def outer_cluster_candidate(
    candidates: list[Line], low: float, high: float, side: str
) -> Line:
    """Choose the last/first strong edge cluster, then its strongest line."""
    allowed = sorted(
        candidate_in_range(candidates, low, high),
        key=lambda candidate: candidate.intercept,
    )
    if not allowed:
        raise RuntimeError(f"No {side} edge candidates in physical boundary band")
    strongest = max(candidate.score for candidate in allowed)
    threshold = max(0.025, strongest * 0.55)
    eligible = [candidate for candidate in allowed if candidate.score >= threshold]
    if not eligible:
        return max(allowed, key=lambda candidate: candidate.score)

    clusters: list[list[Line]] = []
    for candidate in eligible:
        if not clusters or candidate.intercept - clusters[-1][-1].intercept > 6.5:
            clusters.append([candidate])
        else:
            clusters[-1].append(candidate)
    cluster = clusters[0] if side in {"left", "top"} else clusters[-1]
    return max(cluster, key=lambda candidate: candidate.score)


def detect_unveiled_quad(
    image: Image.Image,
    use_reference: bool = False,
    force_outer: bool = False,
):
    if use_reference:
        raw_quad = scaled_reference_quad(image)
        widths, heights, ratio = quad_measurements(raw_quad)
        metrics = {
            "ratio": ratio,
            "targetRatio": REFERENCE_PROJECTED_RATIO,
            "confidence": 1.0,
            "objective": 1.0,
            "valid": True,
            "referenceCard": REFERENCE_CARD_INDEX,
            "widths": [float(value) for value in widths],
            "heights": [float(value) for value in heights],
            "scale": 1.0,
        }
        return raw_quad, {
            "calibration": "card-07"
        }, metrics

    small, gradient_x, gradient_y, scale = gradient_maps(image)
    width, height = small.size
    candidates = {
        "left": vertical_candidates(gradient_x, "left"),
        "right": vertical_candidates(gradient_x, "right"),
        "top": horizontal_candidates(gradient_y, "top"),
        "bottom": horizontal_candidates(gradient_y, "bottom"),
    }
    row_profile, column_profile = foreground_profiles(small)
    top_profile, _ = sustained_bounds(row_profile)
    left_profile, right_profile = sustained_bounds(column_profile)

    if force_outer:
        left = outer_cluster_candidate(
            candidates["left"], 0.055 * width, 0.26 * width, "left"
        )
        right = outer_cluster_candidate(
            candidates["right"], 0.74 * width, 0.945 * width, "right"
        )
        top = outer_cluster_candidate(
            candidates["top"], 0.002 * height, 0.12 * height, "top"
        )
    else:
        left = candidate_near_profile(
            candidates["left"], left_profile, 0.055 * width, 0.26 * width
        ) or outer_cluster_candidate(
            candidates["left"], 0.055 * width, 0.26 * width, "left"
        )
        right = candidate_near_profile(
            candidates["right"], right_profile, 0.74 * width, 0.945 * width
        ) or outer_cluster_candidate(
            candidates["right"], 0.74 * width, 0.945 * width, "right"
        )
        top = candidate_near_profile(
            candidates["top"], top_profile, 0.002 * height, 0.18 * height
        ) or outer_cluster_candidate(
            candidates["top"], 0.002 * height, 0.12 * height, "top"
        )
    # Pale title bars can resemble the cloth, so the bottom profile is not used.
    # The outermost strong cluster consistently represents the physical edge.
    bottom = outer_cluster_candidate(
        candidates["bottom"], 0.92 * height, 0.998 * height, "bottom"
    )

    def selected_quad() -> np.ndarray:
        return np.array(
            [
                intersect(left, top, width, height),
                intersect(right, top, width, height),
                intersect(right, bottom, width, height),
                intersect(left, bottom, width, height),
            ]
        )

    fallback_reason = "forced-outer-edges" if force_outer else None
    quad_small = selected_quad()
    _, _, initial_ratio = quad_measurements(quad_small)
    if not force_outer and initial_ratio < 0.52:
        # A grey card edge can resemble the cloth and stop the colour profile
        # early. Revert both long sides to their outer physical edge clusters.
        left = outer_cluster_candidate(
            candidates["left"], 0.055 * width, 0.26 * width, "left"
        )
        right = outer_cluster_candidate(
            candidates["right"], 0.74 * width, 0.945 * width, "right"
        )
        fallback_reason = "narrow-profile-boundary"
        quad_small = selected_quad()
    elif not force_outer and initial_ratio > 0.64:
        # A grey top field can delay the foreground profile until inner art.
        top = outer_cluster_candidate(
            candidates["top"], 0.002 * height, 0.12 * height, "top"
        )
        fallback_reason = "short-profile-boundary"
        quad_small = selected_quad()
    raw_quad = quad_small / scale
    widths, heights, ratio = quad_measurements(raw_quad)
    confidence = float(min(left.score, right.score, top.score, bottom.score))
    mean_width = float(np.mean(widths))
    mean_height = float(np.mean(heights))
    valid = (
        0.52 <= ratio <= 0.64
        and min(widths) > image.width * 0.60
        and min(heights) > image.height * 0.84
        and confidence > 0.008
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
        "confidence": confidence,
        "valid": valid,
        "referenceCard": REFERENCE_CARD_INDEX,
        "widths": [float(value) for value in widths],
        "heights": [float(value) for value in heights],
        "widthRatio": mean_width / image.width,
        "heightRatio": mean_height / image.height,
        "profileBounds": {
            "top": top_profile,
            "left": left_profile,
            "right": right_profile,
        },
        "fallback": fallback_reason,
        "scale": scale,
    }
    return raw_quad, lines, metrics


def apply_rounded_alpha(image: Image.Image) -> Image.Image:
    """Remove the background with card-07's four-corner silhouette."""
    width, height = image.size
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
        radius=OUTPUT_CORNER_RADIUS * supersample,
        fill=255,
    )
    mask = mask.resize((width, height), Image.Resampling.LANCZOS)
    output = image.convert("RGBA")
    output.putalpha(mask)
    return output

for suit, suit_zh in [
    ("Wands", "權杖"),
    ("Cups", "聖杯"),
    ("Swords", "寶劍"),
    ("Pentacles", "錢幣"),
]:
    for rank, rank_zh in [
        ("Ace", "一"), ("2", "二"), ("3", "三"), ("4", "四"),
        ("5", "五"), ("6", "六"), ("7", "七"), ("8", "八"),
        ("9", "九"), ("10", "十"), ("Page", "侍者"),
        ("Knight", "騎士"), ("Queen", "皇后"), ("King", "國王"),
    ]:
        CARD_NAMES.append(
            (f"{rank} of {suit}", f"{suit_zh}{rank_zh}", suit, rank)
        )


def source_files(source: Path, back_source: Path) -> list[Path]:
    back_path = back_source.resolve()
    files = sorted(
        path for path in source.glob("*.jpg") if path.resolve() != back_path
    )
    if len(files) != len(CARD_NAMES):
        raise RuntimeError(
            f"The Unveiled source must contain exactly {len(CARD_NAMES)} JPG files; "
            f"found {len(files)}"
        )
    return files


def make_contact_sheet(card_dir: Path, target: Path) -> None:
    cols, rows = 10, 8
    thumb_w, thumb_h = 96, 168
    gap, label_h = 8, 24
    sheet = Image.new(
        "RGB",
        (gap + cols * (thumb_w + gap), gap + rows * (thumb_h + label_h + gap)),
        "#151515",
    )
    draw = ImageDraw.Draw(sheet)
    for index, (name, _, _, _) in enumerate(CARD_NAMES):
        with Image.open(card_dir / f"card-{index:02d}.webp") as image:
            preview = image.convert("RGBA")
            preview.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        row, col = divmod(index, cols)
        x = gap + col * (thumb_w + gap)
        y = gap + row * (thumb_h + label_h + gap)
        sheet.paste(preview, (x, y), preview)
        draw.text((x, y + thumb_h + 3), f"{index:02d} {name[:12]}", fill="#f4e8cf")
    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target, quality=92)


def make_card_back(source: Path, target: Path, diagnostic_target: Path) -> None:
    """Perspective-correct the supplied physical card back like every card face."""
    with Image.open(source) as image:
        artwork = image.convert("RGB")
    quad, _, metrics = detect_unveiled_quad(artwork, force_outer=True)
    if not metrics["valid"]:
        raise RuntimeError(
            "The supplied Unveiled card back could not be detected reliably: "
            f"ratio={metrics['ratio']:.4f}, confidence={metrics['confidence']:.4f}"
        )
    output = apply_rounded_alpha(rectify(artwork, quad, size=OUTPUT_SIZE))
    target.parent.mkdir(parents=True, exist_ok=True)
    output.save(target, "WEBP", quality=91, method=6)
    save_diagnostic(
        artwork,
        quad,
        diagnostic_target,
        "The Unveiled Tarot — card back",
        True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--back-source", type=Path, required=True)
    parser.add_argument("--back-only", action="store_true")
    parser.add_argument("--samples", nargs="*", type=int)
    args = parser.parse_args()

    if args.back_only:
        make_card_back(
            args.back_source,
            args.output / "card-back.webp",
            args.work / "unveiled-diagnostics" / "card-back.jpg",
        )
        return

    files = source_files(args.source, args.back_source)
    indices = args.samples if args.samples is not None else list(range(len(files)))
    card_dir = args.output / "cards"
    thumb_dir = card_dir / "thumbs"
    diagnostic_dir = args.work / "unveiled-diagnostics"
    card_dir.mkdir(parents=True, exist_ok=True)
    thumb_dir.mkdir(parents=True, exist_ok=True)

    report = []
    for index in indices:
        source_path = files[index]
        with Image.open(source_path) as source_image:
            image = source_image.convert("RGB")
        quad, lines, metrics = detect_unveiled_quad(
            image, use_reference=index == REFERENCE_CARD_INDEX
        )
        output = apply_rounded_alpha(rectify(image, quad, size=OUTPUT_SIZE))
        output.save(card_dir / f"card-{index:02d}.webp", "WEBP", quality=91, method=6)
        thumbnail = output.resize((240, 420), Image.Resampling.LANCZOS)
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
        report.append(
            {
                "index": index,
                "source": source_path.name,
                "quad": [[round(float(x), 2), round(float(y), 2)] for x, y in quad],
                "lines": lines,
                "metrics": metrics,
            }
        )
        print(
            f"{index:02d} {CARD_NAMES[index][0]:22} "
            f"ratio={metrics['ratio']:.4f} conf={metrics['confidence']:.4f} "
            f"{'OK' if metrics['valid'] else 'CHECK'}"
        )

    args.work.mkdir(parents=True, exist_ok=True)
    (args.work / "unveiled-detection.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    if len(indices) == len(files):
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
        (args.output / "cards-manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        make_contact_sheet(card_dir, args.work / "unveiled-card-contact.jpg")
        make_card_back(
            args.back_source,
            args.output / "card-back.webp",
            diagnostic_dir / "card-back.jpg",
        )


if __name__ == "__main__":
    main()
