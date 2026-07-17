export const TWIPS_PER_INCH = 1440;
export const POINTS_PER_INCH = 72;
export const MM_PER_INCH = 25.4;
export const EMU_PER_INCH = 914400;
export const HALF_POINTS_PER_POINT = 2;
export const DEFAULT_PIXEL_DPI = 96;

function assertFiniteUnit(value: number, unit: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${unit} value must be finite`);
  }
}

function assertNonNegativeUnit(value: number, unit: string): void {
  assertFiniteUnit(value, unit);
  if (value < 0) {
    throw new RangeError(`${unit} value must be non-negative`);
  }
}

function roundOoxml(value: number): number {
  return Math.round(value);
}

export function inchesToMillimeters(inches: number): number {
  assertFiniteUnit(inches, "inch");
  return inches * MM_PER_INCH;
}

export function millimetersToInches(mm: number): number {
  assertFiniteUnit(mm, "millimeter");
  return mm / MM_PER_INCH;
}

export function inchesToTwips(inches: number): number {
  assertFiniteUnit(inches, "inch");
  return roundOoxml(inches * TWIPS_PER_INCH);
}

export function twipsToInches(twips: number): number {
  assertFiniteUnit(twips, "twip");
  return twips / TWIPS_PER_INCH;
}

export function millimetersToTwips(mm: number): number {
  assertFiniteUnit(mm, "millimeter");
  return inchesToTwips(millimetersToInches(mm));
}

export function twipsToMillimeters(twips: number): number {
  return inchesToMillimeters(twipsToInches(twips));
}

export function pointsToTwips(points: number): number {
  assertFiniteUnit(points, "point");
  return roundOoxml((points / POINTS_PER_INCH) * TWIPS_PER_INCH);
}

export function twipsToPoints(twips: number): number {
  assertFiniteUnit(twips, "twip");
  return (twips / TWIPS_PER_INCH) * POINTS_PER_INCH;
}

export function pointsToHalfPoints(points: number): number {
  assertNonNegativeUnit(points, "point");
  return roundOoxml(points * HALF_POINTS_PER_POINT);
}

export function halfPointsToPoints(halfPoints: number): number {
  assertNonNegativeUnit(halfPoints, "half-point");
  return halfPoints / HALF_POINTS_PER_POINT;
}

export function inchesToEmu(inches: number): number {
  assertFiniteUnit(inches, "inch");
  return roundOoxml(inches * EMU_PER_INCH);
}

export function emuToInches(emu: number): number {
  assertFiniteUnit(emu, "EMU");
  return emu / EMU_PER_INCH;
}

export function pixelsToEmu(pixels: number, dpi = DEFAULT_PIXEL_DPI): number {
  assertNonNegativeUnit(pixels, "pixel");
  assertNonNegativeUnit(dpi, "DPI");
  if (dpi === 0) throw new RangeError("DPI must be greater than zero");
  return inchesToEmu(pixels / dpi);
}

export function emuToPixels(emu: number, dpi = DEFAULT_PIXEL_DPI): number {
  assertNonNegativeUnit(emu, "EMU");
  assertNonNegativeUnit(dpi, "DPI");
  if (dpi === 0) throw new RangeError("DPI must be greater than zero");
  return roundOoxml(emuToInches(emu) * dpi);
}

export function millimetersToEmu(mm: number): number {
  assertFiniteUnit(mm, "millimeter");
  return inchesToEmu(millimetersToInches(mm));
}

export function emuToMillimeters(emu: number): number {
  return inchesToMillimeters(emuToInches(emu));
}

export const mmToTwips = millimetersToTwips;
export const mmToEmu = millimetersToEmu;
