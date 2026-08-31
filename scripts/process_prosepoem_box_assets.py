#!/usr/bin/env python3
"""Build the photographed Prose Poem Tarot box textures.

The 17 supplied photographs are deliberately treated as documentary source
material: every texture below is a perspective-corrected crop of a named
photo.  There is no generative fill, repainting, colour replacement, or
content synthesis.  The quads are fixed in source-pixel coordinates so a
rerun is deterministic and does not depend on a machine-specific vision
library.

The output dimensions match the existing book-box texture contract used by
the immersive tarot workbench.  A labelled contact sheet is emitted for
quick visual QA.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image, ImageDraw, ImageOps


DEFAULT_BOX_SOURCE = Path(r"C:\Users\rayji\Desktop\塔羅專案\散文詩\牌盒")
DEFAULT_BACK_SOURCE = Path(r"C:\Users\rayji\Desktop\塔羅專案\散文詩\牌背")
DEFAULT_OUTPUT = Path("assets/prosepoem/textures")
DEFAULT_CONTACT = Path("work/prosepoem-box-textures.jpg")


Point = tuple[float, float]
Quad = tuple[Point, Point, Point, Point]


@dataclass(frozen=True)
class TextureSpec:
    name: str
    source: str
    quad: Quad
    size: tuple[int, int]
    source_group: str = "box"
    inset: tuple[float, float] = (0.004, 0.004)


# Quads are TL, TR, BR, BL in the intended texture orientation.  Coordinates
# refer to the untouched phone photographs (portrait: 1774x2364; landscape:
# 2364x1774).  Narrow wall crops intentionally retain real folds and paper
# texture; they never include the grey table beyond the physical product.
SPECS: tuple[TextureSpec, ...] = (
    TextureSpec(
        "outer-front.jpg", "S__42803203_0.jpg",
        ((278, 198), (1481, 201), (1469, 2141), (277, 2140)),
        (760, 1000), inset=(0.006, 0.006),
    ),
    TextureSpec(
        "outer-back.jpg", "S__42803205_0.jpg",
        ((244, 111), (1567, 119), (1546, 2202), (237, 2191)),
        (760, 1000), inset=(0.006, 0.006),
    ),
    TextureSpec(
        "outer-inside.jpg", "S__42803214_0.jpg",
        ((393, 324), (1102, 336), (1086, 1458), (402, 1438)),
        (760, 1000), inset=(0.008, 0.008),
    ),
    TextureSpec(
        "outer-left.jpg", "S__42803204_0.jpg",
        ((559, 108), (1238, 108), (1241, 2260), (557, 2261)),
        (420, 1250), inset=(0.008, 0.005),
    ),
    TextureSpec(
        "outer-right.jpg", "S__42803206_0.jpg",
        ((539, 100), (1222, 101), (1215, 2254), (537, 2258)),
        (420, 1250), inset=(0.008, 0.005),
    ),
    TextureSpec(
        "outer-top.jpg", "S__42803207_0.jpg",
        ((69, 901), (1626, 902), (1639, 1660), (72, 1690)),
        (760, 260), inset=(0.010, 0.018),
    ),
    TextureSpec(
        "outer-bottom.jpg", "S__42803208_0.jpg",
        ((82, 932), (1638, 934), (1638, 1684), (83, 1709)),
        (760, 380), inset=(0.010, 0.018),
    ),

    # The guidebook front is visible square-on in 32014.  Its unphotographed
    # reverse is represented by a real, unprinted golden paper face from
    # 32008 rather than invented copy or mirrored cover art.
    TextureSpec(
        "guidebook-front.png", "S__42803214_0.jpg",
        ((1502, 335), (2177, 337), (2164, 1450), (1509, 1438)),
        (600, 760), inset=(0.007, 0.007),
    ),
    TextureSpec(
        "guidebook-back.png", "S__42803208_0.jpg",
        ((157, 1002), (1550, 1002), (1551, 1667), (159, 1681)),
        (600, 760), inset=(0.020, 0.025),
    ),

    # Inner-package faces use only the photographed tray: the pale bird floor
    # from 32020 and its genuine unprinted paper faces from 32007/32008.
    TextureSpec(
        "inner-front.jpg", "S__42803220_0.jpg",
        ((1582, 650), (2124, 650), (2124, 1190), (1584, 1190)),
        (920, 600), inset=(0.012, 0.012),
    ),
    TextureSpec(
        "inner-back.jpg", "S__42803208_0.jpg",
        ((157, 1002), (1550, 1002), (1551, 1667), (159, 1681)),
        (920, 600), inset=(0.020, 0.025),
    ),
    TextureSpec(
        "inner-front-upright.jpg", "S__42803220_0.jpg",
        ((1582, 455), (2124, 454), (2124, 1377), (1585, 1377)),
        (618, 1000), inset=(0.012, 0.018),
    ),
    TextureSpec(
        "inner-back-upright.jpg", "S__42803208_0.jpg",
        ((157, 1002), (1550, 1002), (1551, 1667), (159, 1681)),
        (618, 1000), inset=(0.020, 0.025),
    ),
    TextureSpec(
        "inner-left.jpg", "S__42803208_0.jpg",
        ((260, 1040), (430, 1040), (430, 1640), (260, 1640)),
        (250, 760), inset=(0.020, 0.020),
    ),
    TextureSpec(
        "inner-right.jpg", "S__42803208_0.jpg",
        ((1250, 1040), (1420, 1040), (1420, 1640), (1250, 1640)),
        (250, 760), inset=(0.020, 0.020),
    ),
    TextureSpec(
        "inner-top.jpg", "S__42803208_0.jpg",
        ((250, 1050), (1450, 1050), (1450, 1220), (250, 1220)),
        (920, 250), inset=(0.018, 0.030),
    ),
    TextureSpec(
        "inner-bottom.jpg", "S__42803208_0.jpg",
        ((250, 1460), (1450, 1460), (1450, 1630), (250, 1630)),
        (920, 250), inset=(0.018, 0.030),
    ),

    TextureSpec(
        "card-back.png", "S__42803312.jpg",
        ((281, 201), (1431, 184), (1466, 2175), (316, 2189)),
        (600, 1000), source_group="back", inset=(0.012, 0.012),
    ),
)


EXPECTED_SIZES = {spec.name: spec.size for spec in SPECS}


def bilinear(quad: np.ndarray, u: float, v: float) -> np.ndarray:
    tl, tr, br, bl = quad
    return (
        (1 - u) * (1 - v) * tl
        + u * (1 - v) * tr
        + u * v * br
        + (1 - u) * v * bl
    )


def inset_quad(quad: Iterable[Point], inset_x: float, inset_y: float) -> np.ndarray:
    points = np.asarray(tuple(quad), dtype=np.float64)
    return np.asarray(
        (
            bilinear(points, inset_x, inset_y),
            bilinear(points, 1 - inset_x, inset_y),
            bilinear(points, 1 - inset_x, 1 - inset_y),
            bilinear(points, inset_x, 1 - inset_y),
        ),
        dtype=np.float64,
    )


def perspective_coefficients(dst: np.ndarray, src: np.ndarray) -> tuple[float, ...]:
    """Return PIL output-to-source perspective coefficients."""

    matrix: list[list[float]] = []
    values: list[float] = []
    for (x, y), (u, v) in zip(dst, src):
        matrix.extend(
            (
                [x, y, 1, 0, 0, 0, -u * x, -u * y],
                [0, 0, 0, x, y, 1, -v * x, -v * y],
            )
        )
        values.extend((u, v))
    solved = np.linalg.solve(
        np.asarray(matrix, dtype=np.float64),
        np.asarray(values, dtype=np.float64),
    )
    return tuple(float(value) for value in solved)


def rectify(image: Image.Image, spec: TextureSpec) -> Image.Image:
    width, height = spec.size
    source_quad = inset_quad(spec.quad, *spec.inset)
    destination = np.asarray(
        ((0, 0), (width - 1, 0), (width - 1, height - 1), (0, height - 1)),
        dtype=np.float64,
    )
    return image.transform(
        spec.size,
        Image.Transform.PERSPECTIVE,
        perspective_coefficients(destination, source_quad),
        resample=Image.Resampling.BICUBIC,
    )


def save_texture(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() == ".png":
        image.save(path, "PNG", optimize=True)
    else:
        image.save(path, "JPEG", quality=94, subsampling=0, optimize=True)


def make_contact_sheet(output: Path, target: Path) -> None:
    columns = 5
    cell_width, preview_height = 258, 330
    label_height, gap = 58, 12
    rows = (len(SPECS) + columns - 1) // columns
    sheet = Image.new(
        "RGB",
        (gap + columns * (cell_width + gap), gap + rows * (preview_height + label_height + gap)),
        "#17130e",
    )
    draw = ImageDraw.Draw(sheet)
    for index, spec in enumerate(SPECS):
        with Image.open(output / spec.name) as source_image:
            preview = ImageOps.contain(source_image.convert("RGB"), (cell_width, preview_height))
        row, column = divmod(index, columns)
        x = gap + column * (cell_width + gap)
        y = gap + row * (preview_height + label_height + gap)
        px = x + (cell_width - preview.width) // 2
        py = y + (preview_height - preview.height) // 2
        sheet.paste(preview, (px, py))
        draw.rectangle((x, y, x + cell_width - 1, y + preview_height - 1), outline="#5a4b34")
        draw.text((x, y + preview_height + 5), spec.name, fill="#fff0c4")
        draw.text(
            (x, y + preview_height + 25),
            f"{spec.size[0]}x{spec.size[1]}  <-  {spec.source}",
            fill="#bcae91",
        )
    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target, "JPEG", quality=92, subsampling=0, optimize=True)


def validate(output: Path) -> None:
    actual = {path.name for path in output.iterdir() if path.is_file()}
    expected = set(EXPECTED_SIZES)
    missing = expected - actual
    if missing:
        raise RuntimeError(f"Missing texture outputs: {sorted(missing)}")
    for name, expected_size in EXPECTED_SIZES.items():
        with Image.open(output / name) as image:
            image.load()
            if image.size != expected_size:
                raise RuntimeError(f"{name}: expected {expected_size}, got {image.size}")
            if image.mode not in {"RGB", "RGBA"}:
                raise RuntimeError(f"{name}: unexpected mode {image.mode}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--box-source", type=Path, default=DEFAULT_BOX_SOURCE)
    parser.add_argument("--back-source", type=Path, default=DEFAULT_BACK_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--contact", type=Path, default=DEFAULT_CONTACT)
    args = parser.parse_args()

    roots = {"box": args.box_source, "back": args.back_source}
    image_cache: dict[Path, Image.Image] = {}
    try:
        for spec in SPECS:
            source_path = roots[spec.source_group] / spec.source
            if not source_path.is_file():
                raise FileNotFoundError(source_path)
            if source_path not in image_cache:
                image_cache[source_path] = Image.open(source_path).convert("RGB")
            result = rectify(image_cache[source_path], spec)
            save_texture(result, args.output / spec.name)
            print(f"{spec.name:26} {spec.size[0]:4}x{spec.size[1]:4} <- {spec.source}")
    finally:
        for image in image_cache.values():
            image.close()

    validate(args.output)
    make_contact_sheet(args.output, args.contact)
    print(f"validated {len(SPECS)} textures; contact sheet: {args.contact}")


if __name__ == "__main__":
    main()
