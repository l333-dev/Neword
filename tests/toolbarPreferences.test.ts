import { describe, expect, it } from "vitest";

import {
  DEFAULT_TOOLBAR_COMMAND_ORDER,
  normalizeHiddenToolbarCommands,
  normalizeToolbarOrder,
  TOOLBAR_COMMAND_IDS,
  moveToolbarCommand,
} from "../src/preferences/toolbar";
import { TOOLBAR_COMMAND_DEFINITIONS } from "../src/features/editor/toolbarCommands";

describe("toolbar command definitions", () => {
  it("keeps command ids and default order unique and complete", () => {
    expect(new Set(TOOLBAR_COMMAND_IDS).size).toBe(TOOLBAR_COMMAND_IDS.length);
    expect(new Set(DEFAULT_TOOLBAR_COMMAND_ORDER).size).toBe(DEFAULT_TOOLBAR_COMMAND_ORDER.length);
    expect(DEFAULT_TOOLBAR_COMMAND_ORDER).toEqual([...TOOLBAR_COMMAND_IDS]);

    const definitions = new Map(
      TOOLBAR_COMMAND_DEFINITIONS.map((definition) => [definition.id, definition]),
    );
    for (const id of DEFAULT_TOOLBAR_COMMAND_ORDER) {
      expect(definitions.has(id)).toBe(true);
    }
    for (const definition of TOOLBAR_COMMAND_DEFINITIONS) {
      expect(DEFAULT_TOOLBAR_COMMAND_ORDER).toContain(definition.id);
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.group.length).toBeGreaterThan(0);
    }
  });
});

describe("toolbar preference normalization", () => {
  it("keeps valid stored order and appends missing commands", () => {
    const normalized = normalizeToolbarOrder(["redo", "bold"]);

    expect(normalized[0]).toBe("redo");
    expect(normalized[1]).toBe("bold");
    expect(normalized).toContain("italic");
    expect(normalized).toHaveLength(DEFAULT_TOOLBAR_COMMAND_ORDER.length);
  });

  it("removes duplicates and unknown ids", () => {
    expect(normalizeToolbarOrder(["bold", "missing", "bold", "italic"]).slice(0, 2)).toEqual([
      "bold",
      "italic",
    ]);
  });

  it("generates default order from an empty array", () => {
    expect(normalizeToolbarOrder([])).toEqual(DEFAULT_TOOLBAR_COMMAND_ORDER);
  });

  it("normalizes hidden buttons", () => {
    expect(normalizeHiddenToolbarCommands(["bold", "missing", "bold", "redo"])).toEqual([
      "bold",
      "redo",
    ]);
  });
});

describe("toolbar command movement", () => {
  it("moves a middle item up and down without mutating the source", () => {
    const source = ["bold", "italic", "underline"] as const;

    expect(moveToolbarCommand(source, "italic", "up")).toEqual(["italic", "bold", "underline"]);
    expect(moveToolbarCommand(source, "italic", "down")).toEqual(["bold", "underline", "italic"]);
    expect(source).toEqual(["bold", "italic", "underline"]);
  });

  it("does nothing at boundaries or for missing ids", () => {
    const source = ["bold", "italic", "underline"] as const;

    expect(moveToolbarCommand(source, "bold", "up")).toEqual(source);
    expect(moveToolbarCommand(source, "underline", "down")).toEqual(source);
    expect(moveToolbarCommand(source, "redo", "down")).toEqual(source);
  });
});
