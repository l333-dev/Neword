import { describe, expect, it } from "vitest";

import { layoutGridColumns, resolveLayoutRegions } from "../src/preferences/layout";

describe("layout preference resolution", () => {
  it("places sidebar left and settings right", () => {
    expect(
      resolveLayoutRegions({
        sidebarVisible: true,
        settingsVisible: true,
        sidebarPosition: "left",
        settingsPosition: "right",
      }),
    ).toEqual(["sidebar", "editor", "settings"]);
  });

  it("places sidebar right and settings left", () => {
    expect(
      resolveLayoutRegions({
        sidebarVisible: true,
        settingsVisible: true,
        sidebarPosition: "right",
        settingsPosition: "left",
      }),
    ).toEqual(["settings", "editor", "sidebar"]);
  });

  it("keeps sidebar outside settings when both are on the left", () => {
    expect(
      resolveLayoutRegions({
        sidebarVisible: true,
        settingsVisible: true,
        sidebarPosition: "left",
        settingsPosition: "left",
      }),
    ).toEqual(["sidebar", "settings", "editor"]);
  });

  it("keeps sidebar outside settings when both are on the right", () => {
    expect(
      resolveLayoutRegions({
        sidebarVisible: true,
        settingsVisible: true,
        sidebarPosition: "right",
        settingsPosition: "right",
      }),
    ).toEqual(["editor", "settings", "sidebar"]);
  });

  it("omits hidden regions and always keeps one editor", () => {
    const sidebarHidden = resolveLayoutRegions({
      sidebarVisible: false,
      settingsVisible: true,
      sidebarPosition: "left",
      settingsPosition: "right",
    });
    const settingsHidden = resolveLayoutRegions({
      sidebarVisible: true,
      settingsVisible: false,
      sidebarPosition: "left",
      settingsPosition: "right",
    });
    const bothHidden = resolveLayoutRegions({
      sidebarVisible: false,
      settingsVisible: false,
      sidebarPosition: "right",
      settingsPosition: "left",
    });

    expect(sidebarHidden).toEqual(["editor", "settings"]);
    expect(settingsHidden).toEqual(["sidebar", "editor"]);
    expect(bothHidden).toEqual(["editor"]);
    for (const regions of [sidebarHidden, settingsHidden, bothHidden]) {
      expect(regions.filter((region) => region === "editor")).toHaveLength(1);
    }
  });

  it("creates grid columns for the resolved regions", () => {
    expect(layoutGridColumns(["sidebar", "editor", "settings"])).toBe(
      "minmax(220px, 240px) minmax(360px, 1fr) minmax(240px, 280px)",
    );
  });
});
