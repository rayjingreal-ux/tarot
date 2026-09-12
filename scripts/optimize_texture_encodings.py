"""Create smaller lossless WebP siblings, retaining source pixels, alpha and ICC."""
from io import BytesIO
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    *[f"assets/{deck}/textures/{face}.png" for deck in ("woodland", "redvisions")
      for face in ("guidebook-front", "guidebook-back", "card-back")],
    "assets/prosepoem/textures/guidebook-front.png",
    "assets/prosepoem/textures/guidebook-back.png",
]


def main():
    before = after = 0
    for relative in FILES:
        source = ROOT / relative
        target = source.with_suffix(".webp")
        with Image.open(source) as original:
            encoded = BytesIO()
            options = {"format": "WEBP", "lossless": True, "exact": True, "method": 6}
            if "icc_profile" in original.info:
                options["icc_profile"] = original.info["icc_profile"]
            original.save(encoded, **options)
            payload = encoded.getvalue()
            with Image.open(BytesIO(payload)) as decoded:
                assert original.size == decoded.size
                assert original.convert("RGBA").tobytes() == decoded.convert("RGBA").tobytes()
                assert original.info.get("icc_profile") == decoded.info.get("icc_profile")
            assert len(payload) < source.stat().st_size
            # Never overwrite an independently authored asset.
            if target.exists():
                assert target.read_bytes() == payload, f"Different existing asset: {target}"
            else:
                target.write_bytes(payload)
            before += source.stat().st_size
            after += len(payload)
            print(f"VERIFIED {relative}: {source.stat().st_size} -> {len(payload)} bytes")
    print(f"TOTAL: {before} -> {after} bytes; saved {before - after}")


if __name__ == "__main__":
    main()
