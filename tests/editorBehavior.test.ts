import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createEditorExtensions } from "../src/features/editor/editorConfig";
import {
  defaultEditingPreferences,
  type UserEditingPreferences,
} from "../src/stores/editingPreferences";

function createTestEditor(preferences: UserEditingPreferences): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: createEditorExtensions(() => preferences),
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }],
    },
  });
}

function createEditorWithContent(preferences: UserEditingPreferences, content: object): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: createEditorExtensions(() => preferences),
    content,
  });
}

function press(editor: Editor, key: string, shiftKey = false): void {
  editor.commands.focus("end");
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }),
  );
}

describe("editor line break behavior", () => {
  it("creates a new paragraph with Enter by default", () => {
    const editor = createTestEditor(defaultEditingPreferences);

    press(editor, "Enter");

    expect(editor.getJSON()).toMatchObject({
      content: [{ type: "paragraph" }, { type: "paragraph" }],
    });
    editor.destroy();
  });

  it("creates a hardBreak with Shift+Enter by default", () => {
    const editor = createTestEditor(defaultEditingPreferences);

    press(editor, "Enter", true);

    expect(editor.getJSON()).toMatchObject({
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "A" }, { type: "hardBreak" }],
        },
      ],
    });
    editor.destroy();
  });

  it("swaps Enter and Shift+Enter without changing existing content", () => {
    const preferences: UserEditingPreferences = {
      ...defaultEditingPreferences,
      enterBehavior: "hardBreak",
      shiftEnterBehavior: "newParagraph",
    };
    const editor = createTestEditor(preferences);
    const before = editor.getJSON();

    press(editor, "Enter");

    expect(before).toMatchObject({ content: [{ type: "paragraph" }] });
    expect(editor.getJSON()).toMatchObject({
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "A" }, { type: "hardBreak" }],
        },
      ],
    });
    editor.destroy();
  });

  it("joins an empty paragraph with Backspace", () => {
    const editor = createEditorWithContent(defaultEditingPreferences, {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A" }] },
        { type: "paragraph" },
      ],
    });

    editor.commands.setTextSelection(4);
    press(editor, "Backspace");

    expect(editor.getJSON()).toMatchObject({
      content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }],
    });
    editor.destroy();
  });
});
