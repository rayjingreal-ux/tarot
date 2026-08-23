#!/usr/bin/env python3
"""Build lightweight catalog thumbnails and update a card manifest in place."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="Card manifest JSON file")
    parser.add_argument("--width", type=int, default=192, help="Thumbnail width in pixels")
    parser.add_argument("--quality", type=int, default=74, help="WebP quality")
    parser.add_argument("--force", action="store_true", help="Rebuild thumbnails even when current")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest_path = args.manifest.resolve()
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    cards = payload if isinstance(payload, list) else payload.get("cards", [])
    if not isinstance(cards, list) or not cards:
        raise SystemExit("manifest does not contain a card list")

    built = 0
    skipped = 0
    for card in cards:
        source_value = card.get("file")
        if not source_value:
            continue
        source = (manifest_path.parent / source_value).resolve()
        if not source.is_file():
            raise FileNotFoundError(source)
        destination = source.parent / "thumbs" / f"{source.stem}.webp"
        destination.parent.mkdir(parents=True, exist_ok=True)

        if args.force or not destination.exists() or destination.stat().st_mtime < source.stat().st_mtime:
            with Image.open(source) as image:
                ratio = args.width / image.width
                height = max(1, round(image.height * ratio))
                resized = image.resize((args.width, height), Image.Resampling.LANCZOS)
                resized.save(destination, "WEBP", quality=args.quality, method=6)
            built += 1
        else:
            skipped += 1

        card["thumbnail"] = destination.relative_to(manifest_path.parent).as_posix()

    manifest_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"cards={len(cards)} built={built} skipped={skipped} width={args.width}")


if __name__ == "__main__":
    main()
