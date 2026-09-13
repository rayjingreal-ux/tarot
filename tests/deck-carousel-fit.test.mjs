import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateDeckCarouselCameraFit,
  measureDeckCarouselFrameOccupancy,
} from "../deck-carousel-fit.js";

const DEFINITIONS = [
  { name: "slipcase", bookStyle: false, width: 1, height: 1.54, depth: 0.54, coverDepth: 0 },
  { name: "book box", bookStyle: true, width: 1.18, height: 1.55, depth: 0.34, coverDepth: 0.055 },
];

test("carousel camera fit keeps every animated box corner inside the safe frame", () => {
  for (const definition of DEFINITIONS) {
    for (const aspect of [0.55, 0.77, 1, 1.4]) {
      const fit = calculateDeckCarouselCameraFit(definition, aspect);
      const occupancy = measureDeckCarouselFrameOccupancy(definition, aspect, fit.distance, {
        yawSamples: 720,
        pitchSamples: 25,
      });
      assert.ok(Number.isFinite(fit.distance) && fit.distance > 0, `${definition.name} has a finite camera distance`);
      assert.ok(
        occupancy.maximum <= fit.frameFill + 0.002,
        `${definition.name} at aspect ${aspect} occupies ${occupancy.maximum.toFixed(4)} of the frame`,
      );
    }
  }
});

test("fit remains close enough to read the deck while preserving a visible margin", () => {
  for (const definition of DEFINITIONS) {
    const fit = calculateDeckCarouselCameraFit(definition, 0.77);
    const occupancy = measureDeckCarouselFrameOccupancy(definition, 0.77, fit.distance, {
      yawSamples: 720,
      pitchSamples: 25,
    });
    assert.ok(occupancy.maximum >= 0.88, `${definition.name} is not over-shrunk`);
    assert.ok(occupancy.maximum <= 0.902, `${definition.name} retains the requested frame margin`);
  }
});

test("book cover protrusion needs at least as much distance as a flush body", () => {
  const book = DEFINITIONS[1];
  const withCover = calculateDeckCarouselCameraFit(book, 0.77);
  const withoutCover = calculateDeckCarouselCameraFit({ ...book, bookStyle: false, coverDepth: 0 }, 0.77);
  assert.ok(withCover.distance > withoutCover.distance);
});

test("mobile canvas sizing leaves more than twelve pixels around every rotating box angle", () => {
  const slideWidth = 218;
  const canvasWidth = 178.75;
  const canvasHeight = 178.75 * 7 / 4 * 1.16;
  const fit = calculateDeckCarouselCameraFit(DEFINITIONS[1], canvasWidth / canvasHeight);
  const occupancy = measureDeckCarouselFrameOccupancy(
    DEFINITIONS[1],
    canvasWidth / canvasHeight,
    fit.distance,
    { yawSamples: 720, pitchSamples: 25 },
  );
  const renderedWidth = occupancy.width * canvasWidth;
  const sideMargin = (slideWidth - renderedWidth) / 2;

  assert.ok(sideMargin >= 12, `mobile side margin is ${sideMargin.toFixed(2)}px`);
});
