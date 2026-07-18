import type { LayoutPreferences } from "./userPreferences";

export type LayoutRegion = "sidebar" | "editor" | "settings";

export function resolveLayoutRegions(
  layout: Pick<
    LayoutPreferences,
    "sidebarPosition" | "settingsPosition" | "sidebarVisible" | "settingsVisible"
  >,
): LayoutRegion[] {
  const leftRegions: LayoutRegion[] = [];
  const rightRegions: LayoutRegion[] = [];

  if (layout.sidebarVisible && layout.sidebarPosition === "left") {
    leftRegions.push("sidebar");
  }
  if (layout.settingsVisible && layout.settingsPosition === "left") {
    leftRegions.push("settings");
  }
  if (layout.settingsVisible && layout.settingsPosition === "right") {
    rightRegions.push("settings");
  }
  if (layout.sidebarVisible && layout.sidebarPosition === "right") {
    rightRegions.push("sidebar");
  }

  return [...leftRegions, "editor", ...rightRegions];
}

export function layoutGridColumns(regions: readonly LayoutRegion[]): string {
  return regions
    .map((region) => {
      if (region === "editor") return "minmax(360px, 1fr)";
      if (region === "sidebar") return "minmax(220px, 240px)";
      return "minmax(240px, 280px)";
    })
    .join(" ");
}
