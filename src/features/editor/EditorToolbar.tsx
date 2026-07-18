import type { Editor } from "@tiptap/react";

import {
  DEFAULT_TOOLBAR_COMMAND_ORDER,
  normalizeHiddenToolbarCommands,
  normalizeToolbarOrder,
  type ToolbarCommandId,
} from "../../preferences/toolbar";
import type { ToolbarPreferences } from "../../preferences/userPreferences";
import { toolbarCommandDefinitionsById } from "./toolbarCommands";

type EditorToolbarProps = {
  editor: Editor | null;
  preferences?: ToolbarPreferences;
  position?: "top" | "bottom";
  onInsertImage: () => void;
  onInsertPageBreak: () => void;
};

const defaultToolbarPreferences: ToolbarPreferences = {
  buttonOrder: DEFAULT_TOOLBAR_COMMAND_ORDER,
  hiddenButtons: [],
  buttonSize: "medium",
  showLabels: false,
};

export function EditorToolbar({
  editor,
  preferences = defaultToolbarPreferences,
  position = "top",
  onInsertImage,
  onInsertPageBreak,
}: EditorToolbarProps) {
  const order = normalizeToolbarOrder(preferences.buttonOrder);
  const hiddenButtons = new Set(normalizeHiddenToolbarCommands(preferences.hiddenButtons));
  const visibleDefinitions = order
    .filter((id) => !hiddenButtons.has(id))
    .map((id) => toolbarCommandDefinitionsById.get(id))
    .filter((definition) => definition !== undefined);

  return (
    <div
      className="toolbar"
      aria-label="書式ツールバー"
      data-position={position}
      data-button-size={preferences.buttonSize}
      data-show-labels={preferences.showLabels}
    >
      {visibleDefinitions.map((definition, index) => {
        const previous = visibleDefinitions[index - 1];
        const separated = previous !== undefined && previous.group !== definition.group;
        const disabled =
          editor === null || (definition.isEnabled ? !definition.isEnabled(editor) : false);
        const active = editor !== null && (definition.isActive?.(editor) ?? false);
        return (
          <button
            key={definition.id}
            type="button"
            className={separated ? "toolbar-group-start" : undefined}
            disabled={disabled}
            aria-label={definition.label}
            aria-pressed={active || undefined}
            title={definition.label}
            onClick={() => {
              if (!editor) return;
              definition.execute({ editor, onInsertImage, onInsertPageBreak });
            }}
          >
            <span className="toolbar-button-icon" aria-hidden="true">
              {definition.shortLabel}
            </span>
            {preferences.showLabels ? (
              <span className="toolbar-button-label">{definition.label}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export type { ToolbarCommandId };
