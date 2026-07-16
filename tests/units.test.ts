import { describe, expect, it } from "vitest";

import { mmToEmu, mmToTwips, pixelsToEmu, pointsToHalfPoints, pointsToTwips } from "../src/converters/units";

describe("unit conversions", () => {
  it("converts millimeters to twips", () => {
    expect(mmToTwips(25.4)).toBe(1440);
  });

  it("converts points to twips and half-points", () => {
    expect(pointsToTwips(12)).toBe(240);
    expect(pointsToHalfPoints(11)).toBe(22);
  });

  it("converts pixels and millimeters to EMU", () => {
    expect(pixelsToEmu(96)).toBe(914400);
    expect(mmToEmu(25.4)).toBe(914400);
  });
});
