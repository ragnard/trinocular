/**
 * Which palette the app draws in, as a three-way choice rather than a toggle.
 *
 * "System" is a position you can come back to. The toggle this replaces
 * latched a `manualOverride` flag the first time it was clicked, after which
 * the app stopped following `prefers-color-scheme` for the rest of the
 * session with nothing left to unlatch it — the one thing a person is most
 * likely to want back is the one thing it could not do.
 *
 * The choice is remembered, because a menu reading "Dark" over a window that
 * came up light would make the choice look like it had never been taken. Only
 * an explicit one is written down: "system" is the absence of a preference, so
 * it is stored as the absence of a key. It is a browser preference (`prefs.ts`),
 * like the pane layout: a property of this screen and not of the workspace.
 */
import { readPref, writePref } from "./prefs";

export type ThemeChoice = "system" | "light" | "dark";

const PREF = "theme";

const stored = (): ThemeChoice =>
  readPref(PREF, (v) => (v === "light" || v === "dark" ? v : undefined)) ?? "system";

class Theme {
  choice: ThemeChoice = $state(stored());

  /** What the OS currently says, tracked only while `watch` is mounted. */
  #system: "light" | "dark" = $state("light");

  /** The palette to actually draw in. */
  get resolved(): "light" | "dark" {
    return this.choice === "system" ? this.#system : this.choice;
  }

  pick(choice: ThemeChoice) {
    this.choice = choice;
    writePref(PREF, choice === "system" ? undefined : choice);
  }

  /**
   * Follows the OS preference until the returned unsubscribe is called.
   * Mounted from an `$effect`, which is also the first moment there is a
   * `window` to ask.
   */
  watch() {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    this.#system = mq.matches ? "dark" : "light";
    const handler = (e: MediaQueryListEvent) => (this.#system = e.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }
}

/**
 * Built here rather than inside whichever component asks for it first: a rune
 * built inside a reaction is not something that reaction can observe. See the
 * convention in CLAUDE.md.
 */
export const theme = new Theme();
