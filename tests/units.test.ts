import { describe, expect, it } from "vitest";

import {
  emuToPixels,
  halfPointsToPoints,
  millimetersToTwips,
  mmToEmu,
  mmToTwips,
  pixelsToEmu,
  pixelsToPoints,
  pointsToHalfPoints,
  pointsToPixels,
  pointsToTwips,
  twipsToMillimeters,
  twipsToPoints,
} from "../src/converters/units";

describe("unit conversions", () => {
  it("converts millimeters to twips", () => {
    expect(mmToTwips(25.4)).toBe(1440);
    expect(millimetersToTwips(210)).toBe(11906);
    expect(millimetersToTwips(297)).toBe(16838);
    expect(twipsToMillimeters(11906)).toBeCloseTo(210, 1);
  });

  it("converts points to twips and half-points", () => {
    expect(pointsToTwips(12)).toBe(240);
    expect(twipsToPoints(240)).toBe(12);
    expect(pointsToHalfPoints(11)).toBe(22);
    expect(halfPointsToPoints(22)).toBe(11);
  });

  it("converts pixels and millimeters to EMU", () => {
    expect(pixelsToEmu(96)).toBe(914400);
    expect(emuToPixels(914400)).toBe(96);
    expect(mmToEmu(25.4)).toBe(914400);
  });

  it("converts pixels and points for editor defaults", () => {
    expect(pixelsToPoints(8)).toBe(6);
    expect(pointsToPixels(6)).toBe(8);
  });

  it("rejects invalid unit inputs", () => {
    expect(() => pixelsToEmu(-1)).toThrow(RangeError);
    expect(() => pixelsToEmu(1, 0)).toThrow(RangeError);
    expect(() => pixelsToPoints(1, 0)).toThrow(RangeError);
    expect(() => mmToTwips(Number.NaN)).toThrow(RangeError);
  });
});
