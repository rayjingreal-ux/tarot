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
    inset_quad,
    intersect,
    rectify,
    save_diagnostic,
)


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


def find_outer_vertical(gradient: np.ndarray, side: str) -> Line:
    """Prefer the consistent physical card boundary over inner picture frames."""
    height, width = gradient.shape
    y0, y1 = int(0.12 * height), int(0.88 * height)
    if side == "left":
        candidates = np.linspace(0.075 * width, 0.205 * width, 170)
    else:
        candidates = np.linspace(0.82 * width, 0.94 * width, 170)
    slopes = np.linspace(-0.055, 0.055, 35)
    best = Line(0, 0, -1)
    for slope in slopes:
        for intercept in candidates:
            score = _line_score_vertical(
                gradient, float(slope), float(intercept), y0, y1
            )
            if score > best.score:
                best = Line(float(slope), float(intercept), score)
    return best


def find_outer_horizontal(gradient: np.ndarray, side: str) -> Line:
    """Find the pale card edge, not the stronger inner artwork/title border."""
    height, width = gradient.shape
    x0, x1 = int(0.20 * width), int(0.80 * width)
    if side == "top":
        candidates = np.linspace(0.002 * height, 0.09 * height, 170)
    else:
        candidates = np.linspace(0.94 * height, 0.998 * height, 170)
    slopes = np.linspace(-0.055, 0.055, 35)
    best = Line(0, 0, -1)
    for slope in slopes:
        for intercept in candidates:
            score = _line_score_horizontal(
                gradient, float(slope), float(intercept), x0, x1
            )
            if score > best.score:
                best = Line(float(slope), float(intercept), score)
    return best


def detect_unveiled_quad(image: Image.Image):
    small, gradient_x, gradient_y, scale = gradient_maps(image)
    left = find_outer_vertical(gradient_x, "left")
    right = find_outer_vertical(gradient_x, "right")
    top = find_outer_horizontal(gradient_y, "top")
    bottom = find_outer_horizontal(gradient_y, "bottom")
    width, height = small.size
    quad_small = np.array(
        [
            intersect(left, top, width, height),
            intersect(right, top, width, height),
            intersect(right, bottom, width, height),
            intersect(left, bottom, width, height),
        ]
    )
    quad = quad_small / scale
    widths = [
        np.linalg.norm(quad[1] - quad[0]),
        np.linalg.norm(quad[2] - quad[3]),
    ]
    heights = [
        np.linalg.norm(quad[3] - quad[0]),
        np.linalg.norm(quad[2] - quad[1]),
    ]
    ratio = float(np.mean(widths) / np.mean(heights))
    confidence = float(min(left.score, right.score, top.score, bottom.score))
    valid = (
        0.50 <= ratio <= 0.64
        and min(widths) > image.width * 0.48
        and min(heights) > image.height * 0.82
        and confidence > 0.010
    )
    lines = {
        "left": left.__dict__,
        "right": right.__dict__,
        "top": top.__dict__,
        "bottom": bottom.__dict__,
    }
    metrics = {
        "ratio": ratio,
        "confidence": confidence,
        "valid": valid,
        "widths": [float(value) for value in widths],
        "heights": [float(value) for value in heights],
        "scale": scale,
    }
    return inset_quad(quad, inset_x=0.004, inset_y=0.004), lines, metrics

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
            preview = image.convert("RGB")
            preview.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        row, col = divmod(index, cols)
        x = gap + col * (thumb_w + gap)
        y = gap + row * (thumb_h + label_h + gap)
        sheet.paste(preview, (x, y))
        draw.text((x, y + thumb_h + 3), f"{index:02d} {name[:12]}", fill="#f4e8cf")
    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target, quality=92)


def make_card_back(source: Path, target: Path, diagnostic_target: Path) -> None:
    """Perspective-correct the supplied physical card back like every card face."""
    with Image.open(source) as image:
        artwork = image.convert("RGB")
    quad, _, metrics = detect_unveiled_quad(artwork)
    if not metrics["valid"]:
        raise RuntimeError(
            "The supplied Unveiled card back could not be detected reliably: "
            f"ratio={metrics['ratio']:.4f}, confidence={metrics['confidence']:.4f}"
        )
    output = rectify(artwork, quad)
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
        quad, lines, metrics = detect_unveiled_quad(image)
        output = rectify(image, quad)
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
