export const TWIPS_PER_INCH = 1440;
export const MM_PER_INCH = 25.4;
export const EMU_PER_INCH = 914400;

export function mmToTwips(mm: number): number {
  return Math.round((mm / MM_PER_INCH) * TWIPS_PER_INCH);
}

export function pointsToTwips(points: number): number {
  return Math.round(points * 20);
}

export function pointsToHalfPoints(points: number): number {
  return Math.round(points * 2);
}

export function pixelsToEmu(pixels: number, dpi = 96): number {
  return Math.round((pixels / dpi) * EMU_PER_INCH);
}

export function mmToEmu(mm: number): number {
  return Math.round((mm / MM_PER_INCH) * EMU_PER_INCH);
}
