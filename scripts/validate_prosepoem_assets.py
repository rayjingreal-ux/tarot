#!/usr/bin/env python3
"""Validate the normalized Prose Poem Tarot web assets and geometry report."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw


CARD_COUNT = 80
FULL_SIZE = (640, 1120)
THUMB_SIZE = (240, 420)
CORNER_RADIUS = 28
REFERENCE_CARD_INDEX = 60
REFERENCE_SOURCE_NAME = "S__42803289_0.jpg"
REFERENCE_RATIO = 0.5900700717420576
MAX_RATIO_DELTA = 0.025


def expected_mask(size: tuple[int, int], radius: int = CORNER_RADIUS) -> Image.Image:
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


EXPECTED_FULL_ALPHA = expected_mask(FULL_SIZE).tobytes()
EXPECTED_THUMB_ALPHA = expected_mask(FULL_SIZE).resize(
    THUMB_SIZE, Image.Resampling.LANCZOS
).tobytes()


def read_alpha(path: Path, expected_size: tuple[int, int]) -> bytes:
    if not path.is_file():
        raise AssertionError(f"missing asset: {path}")
    with Image.open(path) as image:
        if image.format != "WEBP":
            raise AssertionError(f"{path} must be WEBP, got {image.format}")
        if image.mode != "RGBA":
            raise AssertionError(f"{path} must be RGBA, got {image.mode}")
        if image.size != expected_size:
            raise AssertionError(
                f"{path} must be {expected_size[0]}x{expected_size[1]}, got {image.size}"
            )
        alpha = image.getchannel("A")
        width, height = image.size
        corner_alpha = [
            alpha.getpixel((0, 0)),
            alpha.getpixel((width - 1, 0)),
            alpha.getpixel((0, height - 1)),
            alpha.getpixel((width - 1, height - 1)),
        ]
        solid_alpha = [
            alpha.getpixel((width // 2, height // 2)),
            alpha.getpixel((width // 2, 2)),
            alpha.getpixel((width // 2, height - 3)),
            alpha.getpixel((2, height // 2)),
            alpha.getpixel((width - 3, height // 2)),
        ]
        if max(corner_alpha) > 8:
            raise AssertionError(f"{path} has opaque pixels in a rounded corner")
        if min(solid_alpha) < 247:
            raise AssertionError(f"{path} has an unexpectedly transparent card edge")
        if alpha.getextrema() != (0, 255):
            raise AssertionError(f"{path} alpha range must be 0..255")
        return alpha.tobytes()


def validate_manifest(assets: Path) -> list[dict]:
    manifest_path = assets / "cards-manifest.json"
    if not manifest_path.is_file():
        raise AssertionError(f"missing manifest: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, list) or len(manifest) != CARD_COUNT:
        raise AssertionError(f"manifest must contain exactly {CARD_COUNT} cards")
    if [card.get("index") for card in manifest] != list(range(CARD_COUNT)):
        raise AssertionError("manifest indices must be continuous from 0 through 79")
    for index, card in enumerate(manifest):
        expected_file = f"cards/card-{index:02d}.webp"
        expected_thumbnail = f"cards/thumbs/card-{index:02d}.webp"
        if card.get("file") != expected_file:
            raise AssertionError(f"card {index:02d} has unexpected file path")
        if card.get("thumbnail") != expected_thumbnail:
            raise AssertionError(f"card {index:02d} has unexpected thumbnail path")
        for field in ("name", "nameZh", "suit", "rank"):
            if not isinstance(card.get(field), str) or not card[field]:
                raise AssertionError(f"card {index:02d} has invalid {field}")

    expected_variants = {
        5: ("The Hierophant A", "V-A"),
        6: ("The Hierophant B", "V-B"),
        60: ("10 of Swords A", "10-A"),
        61: ("10 of Swords B", "10-B"),
    }
    for index, (name, rank) in expected_variants.items():
        if manifest[index].get("name") != name or manifest[index].get("rank") != rank:
            raise AssertionError(f"card {index:02d} does not preserve its A/B variant")
    return manifest


def validate_metrics(metrics: dict, label: str) -> float:
    if metrics.get("valid") is not True:
        raise AssertionError(f"{label} perspective detection is not valid")
    ratio = float(metrics.get("ratio"))
    ratio_delta = abs(ratio - REFERENCE_RATIO)
    reported_delta = float(metrics.get("ratioDelta"))
    if abs(reported_delta - ratio_delta) > 1e-9:
        raise AssertionError(f"{label} reports an inconsistent ratio delta")
    if not 0.55 <= ratio <= 0.63:
        raise AssertionError(f"{label} has implausible projected ratio {ratio:.6f}")
    if ratio_delta > MAX_RATIO_DELTA:
        raise AssertionError(
            f"{label} differs from the Prose Poem reference by {ratio_delta:.6f}; "
            f"limit is {MAX_RATIO_DELTA:.6f}"
        )
    if float(metrics.get("confidence")) <= 0.006:
        raise AssertionError(f"{label} edge confidence is too low")
    widths = metrics.get("widths")
    heights = metrics.get("heights")
    if not isinstance(widths, list) or len(widths) != 2:
        raise AssertionError(f"{label} must report two projected widths")
    if not isinstance(heights, list) or len(heights) != 2:
        raise AssertionError(f"{label} must report two projected heights")
    if min(float(value) for value in widths + heights) <= 0:
        raise AssertionError(f"{label} has non-positive projected dimensions")
    return ratio_delta


def validate_detection(report_path: Path) -> tuple[float, float]:
    if not report_path.is_file():
        raise AssertionError(f"missing detection report: {report_path}")
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if not isinstance(report, dict):
        raise AssertionError("detection report must be an object")
    if report.get("cardCount") != CARD_COUNT or report.get("run") != "full":
        raise AssertionError("detection report must describe a complete 80-card run")
    if report.get("selectedIndices") != list(range(CARD_COUNT)):
        raise AssertionError("detection report selected indices must be 0 through 79")
    if report.get("outputSize") != list(FULL_SIZE):
        raise AssertionError("detection report has the wrong full-size geometry")
    if report.get("thumbnailSize") != list(THUMB_SIZE):
        raise AssertionError("detection report has the wrong thumbnail geometry")
    if report.get("cornerRadius") != CORNER_RADIUS:
        raise AssertionError("detection report must declare corner radius 28")

    reference = report.get("reference")
    if not isinstance(reference, dict):
        raise AssertionError("detection report is missing its Prose Poem reference")
    if reference.get("index") != REFERENCE_CARD_INDEX:
        raise AssertionError("detection report uses the wrong reference index")
    if reference.get("source") != REFERENCE_SOURCE_NAME:
        raise AssertionError("detection report uses the wrong reference photograph")
    if abs(float(reference.get("projectedRatio")) - REFERENCE_RATIO) > 1e-12:
        raise AssertionError("detection report uses the wrong reference ratio")
    if abs(float(reference.get("maxRatioDelta")) - MAX_RATIO_DELTA) > 1e-12:
        raise AssertionError("detection report uses the wrong ratio tolerance")

    cards = report.get("cards")
    if not isinstance(cards, list) or len(cards) != CARD_COUNT:
        raise AssertionError(f"detection report must contain {CARD_COUNT} cards")
    if [entry.get("index") for entry in cards] != list(range(CARD_COUNT)):
        raise AssertionError("detection report indices must be continuous")
    sources = [entry.get("source") for entry in cards]
    if len(set(sources)) != CARD_COUNT or sources != sorted(sources, key=str.casefold):
        raise AssertionError("detection report sources must be unique and filename-sorted")

    deltas = [
        validate_metrics(entry.get("metrics", {}), f"card {entry['index']:02d}")
        for entry in cards
    ]
    card_back = report.get("cardBack")
    if not isinstance(card_back, dict):
        raise AssertionError("detection report is missing the card back")
    back_delta = validate_metrics(card_back.get("metrics", {}), "card back")
    return max(deltas), back_delta


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets", type=Path, default=Path("assets/prosepoem"))
    parser.add_argument(
        "--report", type=Path, default=Path("work/prosepoem-detection.json")
    )
    args = parser.parse_args()

    manifest = validate_manifest(args.assets)
    for card in manifest:
        full_alpha = read_alpha(args.assets / card["file"], FULL_SIZE)
        thumb_alpha = read_alpha(args.assets / card["thumbnail"], THUMB_SIZE)
        if full_alpha != EXPECTED_FULL_ALPHA:
            raise AssertionError(
                f"card {card['index']:02d} does not use the radius-28 full-size mask"
            )
        if thumb_alpha != EXPECTED_THUMB_ALPHA:
            raise AssertionError(
                f"card {card['index']:02d} does not use the shared thumbnail mask"
            )

    back_alpha = read_alpha(args.assets / "card-back.webp", FULL_SIZE)
    if back_alpha != EXPECTED_FULL_ALPHA:
        raise AssertionError("card back does not use the shared radius-28 mask")

    max_delta, back_delta = validate_detection(args.report)
    print(
        f"PASS: {CARD_COUNT} fronts + {CARD_COUNT} thumbnails + card back; "
        "all RGBA radius-28 masks match; "
        f"max face ratio delta={max_delta:.6f}; "
        f"back ratio delta={back_delta:.6f}"
    )


if __name__ == "__main__":
    main()
