#!/usr/bin/env python3
"""Validate The Unveiled Tarot's normalized, transparent web assets."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


CARD_COUNT = 80
FULL_SIZE = (640, 1120)
THUMB_SIZE = (240, 420)
REFERENCE_RATIO = 0.5910248261200236
MAX_RATIO_DELTA = 0.020


def read_alpha(path: Path, expected_size: tuple[int, int]) -> bytes:
    if not path.is_file():
        raise AssertionError(f"missing asset: {path}")
    with Image.open(path) as image:
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
        opaque_alpha = [
            alpha.getpixel((width // 2, height // 2)),
            alpha.getpixel((width // 2, 2)),
            alpha.getpixel((width // 2, height - 3)),
            alpha.getpixel((2, height // 2)),
            alpha.getpixel((width - 3, height // 2)),
        ]
        if max(corner_alpha) > 8:
            raise AssertionError(f"{path} has opaque pixels in a rounded corner")
        if min(opaque_alpha) < 247:
            raise AssertionError(f"{path} has an unexpectedly transparent card edge")
        extrema = alpha.getextrema()
        if extrema != (0, 255):
            raise AssertionError(f"{path} alpha range must be 0..255, got {extrema}")
        return alpha.tobytes()


def validate_manifest(assets: Path) -> list[dict]:
    manifest_path = assets / "cards-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if len(manifest) != CARD_COUNT:
        raise AssertionError(f"manifest must contain {CARD_COUNT} cards")
    if [card.get("index") for card in manifest] != list(range(CARD_COUNT)):
        raise AssertionError("manifest indices must be continuous from 0 through 79")
    return manifest


def validate_detection(report_path: Path) -> float:
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if len(report) != CARD_COUNT:
        raise AssertionError(f"detection report must contain {CARD_COUNT} cards")
    if [entry.get("index") for entry in report] != list(range(CARD_COUNT)):
        raise AssertionError("detection report indices must be continuous")
    invalid = [entry["index"] for entry in report if not entry["metrics"]["valid"]]
    if invalid:
        raise AssertionError(f"invalid perspective detections: {invalid}")
    max_delta = max(
        abs(float(entry["metrics"]["ratio"]) - REFERENCE_RATIO)
        for entry in report
    )
    if max_delta > MAX_RATIO_DELTA:
        raise AssertionError(
            f"projected ratio differs from card 07 by {max_delta:.6f}; "
            f"limit is {MAX_RATIO_DELTA:.6f}"
        )
    return max_delta


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets", type=Path, default=Path("assets/unveiled"))
    parser.add_argument(
        "--report", type=Path, default=Path("work/unveiled-detection.json")
    )
    args = parser.parse_args()

    manifest = validate_manifest(args.assets)
    reference_full_alpha = None
    reference_thumb_alpha = None
    for card in manifest:
        full_alpha = read_alpha(args.assets / card["file"], FULL_SIZE)
        thumb_alpha = read_alpha(args.assets / card["thumbnail"], THUMB_SIZE)
        reference_full_alpha = reference_full_alpha or full_alpha
        reference_thumb_alpha = reference_thumb_alpha or thumb_alpha
        if full_alpha != reference_full_alpha:
            raise AssertionError(f"card {card['index']:02d} uses a different full-size mask")
        if thumb_alpha != reference_thumb_alpha:
            raise AssertionError(f"card {card['index']:02d} uses a different thumbnail mask")

    back_alpha = read_alpha(args.assets / "card-back.webp", FULL_SIZE)
    if back_alpha != reference_full_alpha:
        raise AssertionError("card back does not use the same rounded mask as the faces")

    max_delta = validate_detection(args.report)
    print(
        f"PASS: {CARD_COUNT} fronts + {CARD_COUNT} thumbnails + card back; "
        f"RGBA rounded masks match card 07; max ratio delta={max_delta:.6f}"
    )


if __name__ == "__main__":
    main()
