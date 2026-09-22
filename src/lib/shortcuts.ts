/**
 * The keyboard shortcuts, as a table of facts rather than markup: what the
 * `Shortcuts` dialog draws, one section per surface. A binding lives in the
 * component that answers it — the table's `handleKeydown`, the tree's, the
 * monaco actions — and this list only describes them, so a key added there
 * has to be added here too or the dialog will not know it.
 *
 * A combo is written with `Mod` for the platform's command key and `Shift`
 * for shift, and `formatKeys` spells them for the platform: `⌘↵` on a Mac and
 * `Ctrl+↵` elsewhere. The document header used to hardcode `⌘P`, which was
 * wrong for every Linux and Windows reader.
 */

export type Pane = "browser" | "editor" | "results" | "inspector";

export interface Shortcut {
  /** Each entry is one key or chord, drawn as its own `<kbd>`. */
  keys: string[];
  label: string;
}

export interface ShortcutSection {
  /** The pane the section belongs to, for tinting the one that had focus. */
  pane?: Pane;
  title: string;
  items: Shortcut[];
}

export const SHORTCUTS: ShortcutSection[] = [
  {
    title: "Everywhere",
    items: [
      { keys: ["Mod+P"], label: "Switch file" },
      { keys: ["?"], label: "Keyboard shortcuts" }
    ]
  },
  {
    pane: "editor",
    title: "Editor",
    items: [
      { keys: ["Mod+↵"], label: "Run the statement at the caret" },
      { keys: ["Mod+K", "Mod+S"], label: "Keyboard shortcuts" },
      { keys: ["F1"], label: "All editor commands" }
    ]
  },
  {
    pane: "results",
    title: "Results",
    items: [
      { keys: ["↑↓←→"], label: "Move" },
      { keys: ["Shift+↑↓←→"], label: "Extend the selection" },
      { keys: ["Space"], label: "Row ↔ cell selection" },
      { keys: ["↵"], label: "Open the row in full window" },
      { keys: ["Mod+C"], label: "Copy the selection" },
      { keys: ["Esc"], label: "Clear the selection" }
    ]
  },
  {
    pane: "inspector",
    title: "Inspector",
    items: [
      { keys: ["↑↓"], label: "Previous / next row" },
      { keys: ["Shift+↑↓"], label: "Extend the selection (pane only)" },
      { keys: ["Home", "End"], label: "First / last row" },
      { keys: ["Esc"], label: "Clear the filter · close full window" }
    ]
  },
  {
    pane: "browser",
    title: "Data browser",
    items: [
      { keys: ["↑↓"], label: "Move" },
      { keys: ["→"], label: "Open a branch, then step in" },
      { keys: ["←"], label: "Close a branch, then step out" },
      { keys: ["Home", "End"], label: "First / last row" },
      { keys: ["↵", "Space"], label: "Expand / collapse" },
      { keys: ["Mod+C"], label: "Copy the name" },
      { keys: ["Tab"], label: "The row's own buttons" },
      { keys: ["Esc"], label: "Clear the filter" }
    ]
  },
  {
    title: "Pane dividers",
    items: [
      { keys: ["↑↓←→"], label: "Resize a focused divider" },
      { keys: ["Shift+↑↓←→"], label: "Resize by more" },
      { keys: ["Home", "End"], label: "Collapse either way" }
    ]
  }
];

/** Whether the command key is `⌘`: read once, off the platform. */
export const isMac: boolean =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** `Mod+P` as `⌘P` on a Mac and `Ctrl+P` elsewhere; `Shift` as `⇧` or spelled. */
export function formatKeys(combo: string, mac: boolean = isMac): string {
  return mac
    ? combo.replace(/Mod\+/g, "⌘").replace(/Shift\+/g, "⇧")
    : combo.replace(/Mod\+/g, "Ctrl+");
}

/**
 * Whether a key pressed with `target` focused is being typed rather than
 * pressed — an input, a textarea (monaco's is one), anything editable — so a
 * single-key chord like `?` stays out of the way of the text.
 */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}
