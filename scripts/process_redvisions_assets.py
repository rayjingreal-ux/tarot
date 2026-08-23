#!/usr/bin/env python3
"""Perspective-correct and normalize the photographed Red Visions tarot deck.

The source photos contain a physical card on pale fabric.  This script finds the
four long, nearly straight card edges independently for every photograph,
warps the card to a common 4:7 canvas, and applies a tiny inward safety crop so
rounded corners cannot leave fabric pixels in the exported texture.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


SOURCE_FILES = [
    "S__42688530_0.jpg", "S__42688531_0.jpg", "S__42688532_0.jpg",
    "S__42688533_0.jpg", "S__42688534_0.jpg", "S__42688535_0.jpg",
    "S__42688536_0.jpg", "S__42688537_0.jpg", "S__42688538_0.jpg",
    "S__42688539_0.jpg", "S__42688541_0.jpg", "S__42688542_0.jpg",
    "S__42688543_0.jpg", "S__42688544_0.jpg", "S__42688545_0.jpg",
    "S__42688546_0.jpg", "S__42688547_0.jpg", "S__42688548_0.jpg",
    "S__42688549_0.jpg", "S__42688550_0.jpg", "S__42688552_0.jpg",
    "S__42688553_0.jpg",
    "S__42688555_0.jpg", "S__42688556_0.jpg", "S__42688557_0.jpg",
    "S__42688558_0.jpg", "S__42688559_0.jpg", "S__42688560_0.jpg",
    "S__42688561_0.jpg", "S__42688562_0.jpg", "S__42688563_0.jpg",
    "S__42688564_0.jpg", "S__42688566_0.jpg", "S__42688567_0.jpg",
    "S__42688568_0.jpg", "S__42688569_0.jpg",
    "S__42688571_0.jpg", "S__42688572_0.jpg", "S__42688573_0.jpg",
    "S__42688574_0.jpg", "S__42688575_0.jpg", "S__42688576_0.jpg",
    "S__42688577_0.jpg", "S__42688578_0.jpg", "S__42688579_0.jpg",
    "S__42688580_0.jpg", "S__42688582_0.jpg", "S__42688583_0.jpg",
    "S__42688584_0.jpg", "S__42688585_0.jpg",
    "S__42688587_0.jpg", "S__42688588_0.jpg", "S__42688589_0.jpg",
    "S__42688590_0.jpg", "S__42688591_0.jpg", "S__42688592_0.jpg",
    "S__42688593_0.jpg", "S__42688594_0.jpg", "S__42688595_0.jpg",
    "S__42688596_0.jpg", "S__42688598_0.jpg", "S__42688599_0.jpg",
    "S__42688600_0.jpg", "S__42688601_0.jpg",
    "S__42688603_0.jpg", "S__42688604_0.jpg", "S__42688605_0.jpg",
    "S__42688606_0.jpg", "S__42688607_0.jpg", "S__42688608_0.jpg",
    "S__42688609_0.jpg", "S__42688610_0.jpg", "S__42688611_0.jpg",
    "S__42688612_0.jpg", "S__42688614_0.jpg", "S__42688615_0.jpg",
    "S__42688616_0.jpg", "S__42688617_0.jpg",
]

CARD_NAMES = [
    ("The Fool", "愚者", "Major Arcana", "0"),
    ("The Magician", "魔術師", "Major Arcana", "I"),
    ("The High Priestess", "女祭司", "Major Arcana", "II"),
    ("The Empress", "皇后", "Major Arcana", "III"),
    ("The Emperor", "皇帝", "Major Arcana", "IV"),
    ("The Hierophant", "教皇", "Major Arcana", "V"),
    ("The Lovers", "戀人", "Major Arcana", "VI"),
    ("The Chariot", "戰車", "Major Arcana", "VII"),
    ("Strength", "力量", "Major Arcana", "VIII"),
    ("The Hermit", "隱者", "Major Arcana", "IX"),
    ("Wheel of Fortune", "命運之輪", "Major Arcana", "X"),
    ("Justice", "正義", "Major Arcana", "XI"),
    ("The Hanged Man", "倒吊人", "Major Arcana", "XII"),
    ("Death", "死神", "Major Arcana", "XIII"),
    ("Temperance", "節制", "Major Arcana", "XIV"),
    ("The Devil", "惡魔", "Major Arcana", "XV"),
    ("The Tower", "高塔", "Major Arcana", "XVI"),
    ("The Star", "星星", "Major Arcana", "XVII"),
    ("The Moon", "月亮", "Major Arcana", "XVIII"),
    ("The Sun", "太陽", "Major Arcana", "XIX"),
    ("Judgement", "審判", "Major Arcana", "XX"),
    ("The World", "世界", "Major Arcana", "XXI"),
]

for suit, suit_zh in [
    ("Wands", "權杖"), ("Cups", "聖杯"), ("Swords", "寶劍"), ("Coins", "錢幣")
]:
    ranks = [
        ("Ace", "一"), ("2", "二"), ("3", "三"), ("4", "四"), ("5", "五"),
        ("6", "六"), ("7", "七"), ("8", "八"), ("9", "九"), ("10", "十"),
        ("Page", "侍者"), ("Knight", "騎士"), ("Queen", "皇后"), ("King", "國王"),
    ]
    for rank, rank_zh in ranks:
        CARD_NAMES.append(
            (f"{rank} of {suit}", f"{suit_zh}{rank_zh}", suit, rank)
        )


@dataclass
class Line:
    slope: float
    intercept: float
    score: float


def gradient_maps(image: Image.Image, max_width: int = 520):
    scale = min(1.0, max_width / image.width)
    small = image.resize(
        (round(image.width * scale), round(image.height * scale)),
        Image.Resampling.BILINEAR,
    )
    rgb = np.asarray(small, dtype=np.float32) / 255.0
    # Luminance plus chroma makes dark and light card edges equally visible.
    lum = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    gx_l = np.zeros_like(lum)
    gy_l = np.zeros_like(lum)
    gx_l[:, 1:-1] = np.abs(lum[:, 2:] - lum[:, :-2])
    gy_l[1:-1] = np.abs(lum[2:] - lum[:-2])
    gx_c = np.zeros_like(lum)
    gy_c = np.zeros_like(lum)
    gx_c[:, 1:-1] = np.mean(np.abs(rgb[:, 2:] - rgb[:, :-2]), axis=2)
    gy_c[1:-1] = np.mean(np.abs(rgb[2:] - rgb[:-2]), axis=2)
    gx = gx_l + 0.65 * gx_c
    gy = gy_l + 0.65 * gy_c
    return small, gx, gy, scale


def _line_score_vertical(gx, slope, intercept, y0, y1):
    h, w = gx.shape
    ys = np.arange(y0, y1, dtype=np.float32)
    yc = 0.5 * (h - 1)
    xs = np.rint(intercept + slope * (ys - yc)).astype(np.int32)
    valid = (xs >= 2) & (xs < w - 2)
    if valid.mean() < 0.95:
        return -1.0
    vals = np.maximum.reduce([
        gx[ys.astype(np.int32), xs - 1],
        gx[ys.astype(np.int32), xs],
        gx[ys.astype(np.int32), xs + 1],
    ])
    # Long continuous edges should score even if local artwork is stronger.
    return float(0.65 * np.quantile(vals, 0.42) + 0.35 * vals.mean())


def _line_score_horizontal(gy, slope, intercept, x0, x1):
    h, w = gy.shape
    xs = np.arange(x0, x1, dtype=np.float32)
    xc = 0.5 * (w - 1)
    ys = np.rint(intercept + slope * (xs - xc)).astype(np.int32)
    valid = (ys >= 2) & (ys < h - 2)
    if valid.mean() < 0.95:
        return -1.0
    vals = np.maximum.reduce([
        gy[ys - 1, xs.astype(np.int32)],
        gy[ys, xs.astype(np.int32)],
        gy[ys + 1, xs.astype(np.int32)],
    ])
    return float(0.65 * np.quantile(vals, 0.42) + 0.35 * vals.mean())


def find_vertical(gx, side: str) -> Line:
    h, w = gx.shape
    y0, y1 = int(0.11 * h), int(0.91 * h)
    if side == "left":
        candidates = np.linspace(0.055 * w, 0.285 * w, 145)
    else:
        candidates = np.linspace(0.715 * w, 0.945 * w, 145)
    slopes = np.linspace(-0.075, 0.075, 31)
    best = Line(0, 0, -1)
    for slope in slopes:
        for intercept in candidates:
            score = _line_score_vertical(gx, float(slope), float(intercept), y0, y1)
            if score > best.score:
                best = Line(float(slope), float(intercept), score)
    return best


def find_horizontal(gy, side: str) -> Line:
    h, w = gy.shape
    x0, x1 = int(0.15 * w), int(0.85 * w)
    if side == "top":
        candidates = np.linspace(0.025 * h, 0.205 * h, 145)
    else:
        candidates = np.linspace(0.795 * h, 0.98 * h, 145)
    slopes = np.linspace(-0.075, 0.075, 31)
    best = Line(0, 0, -1)
    for slope in slopes:
        for intercept in candidates:
            score = _line_score_horizontal(gy, float(slope), float(intercept), x0, x1)
            if score > best.score:
                best = Line(float(slope), float(intercept), score)
    return best


def intersect(vertical: Line, horizontal: Line, w: int, h: int):
    # x = av * (y-yc)+bv; y = ah * (x-xc)+bh
    av, bv = vertical.slope, vertical.intercept
    ah, bh = horizontal.slope, horizontal.intercept
    xc, yc = 0.5 * (w - 1), 0.5 * (h - 1)
    denom = 1.0 - av * ah
    x = (av * (bh - ah * xc - yc) + bv) / denom
    y = ah * (x - xc) + bh
    return np.array([x, y], dtype=np.float64)


def inset_quad(quad: np.ndarray, inset_x=0.010, inset_y=0.012):
    tl, tr, br, bl = quad

    def bilinear(u, v):
        return (
            (1-u)*(1-v)*tl + u*(1-v)*tr + u*v*br + (1-u)*v*bl
        )

    return np.array([
        bilinear(inset_x, inset_y),
        bilinear(1-inset_x, inset_y),
        bilinear(1-inset_x, 1-inset_y),
        bilinear(inset_x, 1-inset_y),
    ])


def detect_quad(image: Image.Image):
    small, gx, gy, scale = gradient_maps(image)
    left = find_vertical(gx, "left")
    right = find_vertical(gx, "right")
    top = find_horizontal(gy, "top")
    bottom = find_horizontal(gy, "bottom")
    w, h = small.size
    quad_small = np.array([
        intersect(left, top, w, h),
        intersect(right, top, w, h),
        intersect(right, bottom, w, h),
        intersect(left, bottom, w, h),
    ])
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
        and min(heights) > image.height * 0.68
        and confidence > 0.010
    )
    lines = {
        "left": left.__dict__, "right": right.__dict__,
        "top": top.__dict__, "bottom": bottom.__dict__,
    }
    metrics = {
        "ratio": ratio, "confidence": confidence, "valid": valid,
        "widths": [float(v) for v in widths],
        "heights": [float(v) for v in heights],
        "scale": scale,
    }
    return inset_quad(quad), lines, metrics


def perspective_coefficients(dst: np.ndarray, src: np.ndarray):
    # PIL needs coefficients mapping output (destination) coordinates to source.
    matrix, values = [], []
    for (x, y), (u, v) in zip(dst, src):
        matrix.extend([
            [x, y, 1, 0, 0, 0, -u*x, -u*y],
            [0, 0, 0, x, y, 1, -v*x, -v*y],
        ])
        values.extend([u, v])
    return np.linalg.solve(
        np.asarray(matrix, dtype=np.float64),
        np.asarray(values, dtype=np.float64),
    )


def rectify(image: Image.Image, quad: np.ndarray, size=(640, 1120)):
    w, h = size
    dst = np.array([[0, 0], [w-1, 0], [w-1, h-1], [0, h-1]], dtype=np.float64)
    coeffs = perspective_coefficients(dst, quad)
    return image.transform(
        size,
        Image.Transform.PERSPECTIVE,
        data=tuple(coeffs),
        resample=Image.Resampling.BICUBIC,
    )


def save_diagnostic(image: Image.Image, quad, target: Path, label: str, valid: bool):
    preview = image.copy()
    preview.thumbnail((380, 520), Image.Resampling.LANCZOS)
    sx, sy = preview.width / image.width, preview.height / image.height
    draw = ImageDraw.Draw(preview)
    points = [(float(x*sx), float(y*sy)) for x, y in quad]
    draw.line(points + [points[0]], fill="#40ff7a" if valid else "#ff4d5f", width=4)
    draw.text((8, 8), label, fill="white", stroke_width=2, stroke_fill="black")
    target.parent.mkdir(parents=True, exist_ok=True)
    preview.save(target, quality=88)


def make_contact_sheet(card_dir: Path, target: Path):
    cols, rows = 13, 6
    tw, th = 104, 182
    gap, label_h = 8, 22
    sheet = Image.new(
        "RGB",
        (gap + cols*(tw+gap), gap + rows*(th+label_h+gap)),
        "#151515",
    )
    draw = ImageDraw.Draw(sheet)
    for index in range(78):
        image = Image.open(card_dir / f"card-{index:02d}.webp").convert("RGB")
        image.thumbnail((tw, th), Image.Resampling.LANCZOS)
        row, col = divmod(index, cols)
        x = gap + col*(tw+gap)
        y = gap + row*(th+label_h+gap)
        sheet.paste(image, (x, y))
        draw.text((x, y+th+3), f"{index:02d} {CARD_NAMES[index][0][:13]}", fill="#f4e8cf")
    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target, quality=91)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--samples", nargs="*", type=int)
    args = parser.parse_args()

    if len(SOURCE_FILES) != 78 or len(CARD_NAMES) != 78:
        raise RuntimeError("Red Visions source/name map must contain exactly 78 cards")

    indices = args.samples if args.samples is not None else list(range(78))
    card_dir = args.output / "cards"
    thumb_dir = card_dir / "thumbs"
    diag_dir = args.work / "redvisions-diagnostics"
    card_dir.mkdir(parents=True, exist_ok=True)
    thumb_dir.mkdir(parents=True, exist_ok=True)

    report = []
    for index in indices:
        source_path = args.source / SOURCE_FILES[index]
        image = Image.open(source_path).convert("RGB")
        quad, lines, metrics = detect_quad(image)
        output = rectify(image, quad)
        output.save(card_dir / f"card-{index:02d}.webp", "WEBP", quality=91, method=6)
        thumb = output.resize((240, 420), Image.Resampling.LANCZOS)
        thumb.save(thumb_dir / f"card-{index:02d}.webp", "WEBP", quality=82, method=6)
        save_diagnostic(
            image, quad, diag_dir / f"card-{index:02d}.jpg",
            f"{index:02d} {CARD_NAMES[index][0]}", bool(metrics["valid"]),
        )
        report.append({
            "index": index,
            "source": SOURCE_FILES[index],
            "quad": [[round(float(x), 2), round(float(y), 2)] for x, y in quad],
            "lines": lines,
            "metrics": metrics,
        })
        print(
            f"{index:02d} {CARD_NAMES[index][0]:22} "
            f"ratio={metrics['ratio']:.4f} conf={metrics['confidence']:.4f} "
            f"{'OK' if metrics['valid'] else 'CHECK'}"
        )

    args.work.mkdir(parents=True, exist_ok=True)
    (args.work / "redvisions-detection.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    if len(indices) == 78:
        manifest = []
        for index, (name, name_zh, suit, rank) in enumerate(CARD_NAMES):
            manifest.append({
                "index": index,
                "name": name,
                "nameZh": name_zh,
                "suit": suit,
                "rank": rank,
                "file": f"cards/card-{index:02d}.webp",
                "thumbnail": f"cards/thumbs/card-{index:02d}.webp",
            })
        (args.output / "cards-manifest.json").write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        make_contact_sheet(card_dir, args.work / "redvisions-card-contact.jpg")

    # The common back is treated by the same per-photo geometry pipeline.
    back_path = args.source / "卡牌背面.jpg"
    if back_path.exists() and (args.samples is None or 0 in indices):
        back = Image.open(back_path).convert("RGB")
        quad, _, metrics = detect_quad(back)
        rectify(back, quad).save(
            args.output / "card-back.webp", "WEBP", quality=91, method=6
        )
        save_diagnostic(
            back, quad, diag_dir / "card-back.jpg", "CARD BACK",
            bool(metrics["valid"]),
        )


if __name__ == "__main__":
    main()
