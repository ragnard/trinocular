/**
 * What this browser remembers about how the screen is drawn — the theme, the
 * pane layout — as distinct from the workspace, which is what the documents
 * are and travels with the user.
 *
 * A preference is per browser and stays there: it is a property of this
 * screen, not of the files, so it goes in localStorage under its own
 * `trinocular:<name>` key and never in the workspace record, which under a
 * server file store leaves the browser altogether. That is also why the
 * selected file and connection are *not* preferences: they are in the
 * workspace's `ui` record, and follow the user to another browser.
 *
 * Every read is lenient and every access is guarded. `localStorage` throws
 * where site data is blocked (Firefox's `SecurityError`), a stored value can
 * be from an older build with another idea of its shape, and a preference is
 * never worth failing to boot over — so a value that will not read is the
 * absence of one, and the caller's default stands.
 */
import { browser } from "$app/environment";

const PREFIX = "trinocular:";

/**
 * The stored preference, or undefined when there is none, it will not parse,
 * or `parse` declines it. `parse` is handed the decoded JSON and answers with
 * the value or undefined; it is where the shape is checked, since a stored
 * value is only ever what some earlier build wrote.
 */
export function readPref<T>(name: string, parse: (raw: unknown) => T | undefined): T | undefined {
  if (!browser) return undefined;
  try {
    const raw = localStorage.getItem(PREFIX + name);
    return raw === null ? undefined : parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/** Writes the preference, or removes it for undefined: a default is the
 *  absence of a choice, and is stored as the absence of the key. */
export function writePref(name: string, value: unknown): void {
  if (!browser) return;
  try {
    if (value === undefined) localStorage.removeItem(PREFIX + name);
    else localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // Quota or blocked storage: the choice still holds for this page, it is
    // simply not remembered.
  }
}
