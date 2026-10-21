<script lang="ts">
  import type { SqlFile, Workspace } from "$lib/State.svelte";
  import { CloudOff, Plus, X } from "@lucide/svelte";
  import { tick, untrack } from "svelte";
  import type { Attachment } from "svelte/attachments";
  import { textMeasurer } from "$lib/textWidth";

  interface Props {
    workspace: Workspace;
    /** Gives the editor focus back, for a rename begun from inside it. */
    onfocuseditor?: () => void;
  }

  let { workspace, onfocuseditor }: Props = $props();

  /**
   * One tab per file, and every file is a tab: there is no "open" set apart
   * from the workspace's files, so closing a tab deletes its file. Which is
   * why a tab with anything in it asks first.
   *
   * The strip names the documents and nothing about where they run: the
   * cluster is the workspace's, chosen in the data browser's rail.
   */
  let strip: HTMLDivElement | undefined = $state();

  /** The tab being dragged, and the gap it would drop into. */
  let dragging: SqlFile | null = $state(null);
  let dropAt: number | null = $state(null);

  /**
   * The file whose name is being edited in place. The name is edited where
   * it is drawn — the label itself turns editable, in the same font and box —
   * so a tab is the size it was until the name you type is a different
   * length. An input there had a border, its own width, and a jump on open.
   */
  let renaming: SqlFile | null = $state(null);

  /**
   * Somewhere to hand focus back to. The editor is named rather than held by
   * element: the element taking its keystrokes is replaced when the document
   * changes, which the first click of a double-click on another tab does.
   */
  type FocusTarget = HTMLElement | "editor" | null;

  /**
   * Where focus goes when Enter or Escape ends the edit: what had it before
   * the edit began, so the tab is not left holding focus and its ring. (An
   * edit ended by clicking elsewhere leaves focus where the click put it.)
   * For a double-click that is not the tab, which the first click focused,
   * but what had focus when the pointer came down on the strip — usually the
   * editor, so a rename hands you straight back to the query. F2 starts from
   * a focused tab and so returns to it, which is where the keyboard was.
   */
  let returnTo: FocusTarget = null;
  /** What had focus outside the strip when a pointer last came down on it. */
  let focusBefore: FocusTarget = null;

  function notefocus() {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) focusBefore = null;
    else if (strip?.contains(el)) return;
    else focusBefore = el.closest('[data-pane="editor"]') ? "editor" : el;
  }

  /** Hands focus back; false when there is nothing left to hand it to. */
  function restoreFocus(target: FocusTarget): boolean {
    if (target === "editor" && onfocuseditor) {
      onfocuseditor();
      return true;
    }
    if (target instanceof HTMLElement && target.isConnected) {
      target.focus({ preventScroll: true });
      return true;
    }
    return false;
  }

  /**
   * How wide a name is drawn, for the floor a squeezed tab stops at (see
   * `.tab` below). Made once the fonts are in: measured before, it would be
   * measuring the fallback face. Until then every tab floors at 8em, which is
   * only ever too wide, never too narrow.
   */
  let measure: ((text: string) => number) | undefined = $state();
  $effect(() => {
    const el = strip;
    if (!el) return;
    let live = true;
    void document.fonts.ready.then(() => {
      if (live) measure = textMeasurer(el);
    });
    return () => {
      live = false;
    };
  });

  // The active tab has to be on screen once the strip overflows, whether it
  // became active by a click, the file switcher, or a new file at the end.
  $effect(() => {
    const id = workspace.activeFile?.id;
    if (!id || !strip) return;
    strip
      .querySelector(`[data-file="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  // A vertical wheel scrolls the strip sideways: it is the only direction it
  // has to go, and most mice have no other. Added here rather than as an
  // attribute because svelte makes `onwheel` passive, which would ignore the
  // `preventDefault` that keeps the page from scrolling too.
  $effect(() => {
    const el = strip;
    if (!el) return;
    const onwheel = (e: WheelEvent) => {
      if (!e.deltaY || e.deltaX) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", onwheel, { passive: false });
    return () => el.removeEventListener("wheel", onwheel);
  });

  /**
   * Puts the + on whole device pixels. It sits after the tabs, whose widths
   * are the widths of their names and so fractional, in a pane whose left
   * edge is a percentage of the window — so it landed between pixels, and a
   * + is nothing but a horizontal and a vertical stroke, which antialiasing
   * smears across two rows and two columns: it read as blurred beside every
   * other icon. Re-snapped whenever the strip or the rail changes size,
   * which is whenever the + can have moved.
   */
  const snapToPixels: Attachment<HTMLElement> = (el) => {
    const rail = el.parentElement;
    const icon = el.querySelector("svg");
    if (!rail || !icon || !strip) return;
    const snap = () => {
      el.style.translate = "";
      const r = icon.getBoundingClientRect();
      const d = devicePixelRatio;
      const dx = Math.round(r.left * d) / d - r.left;
      const dy = Math.round(r.top * d) / d - r.top;
      el.style.translate = `${dx}px ${dy}px`;
    };
    const observer = new ResizeObserver(snap);
    observer.observe(rail);
    observer.observe(strip);
    return () => observer.disconnect();
  };

  function startRename(file: SqlFile, from: FocusTarget) {
    returnTo = from;
    renaming = file;
  }

  /**
   * Fills the editable label and puts the caret in it. The text is set here
   * rather than rendered as `{file.name}`: the browser rewrites an editable
   * element's text nodes as you type, and a node svelte still believes it
   * owns would be one it could later write into from nowhere.
   */
  function editable(file: SqlFile): Attachment<HTMLElement> {
    return (el) => {
      // Read once, untracked: an attachment re-runs when what it read
      // changes, and another tab renaming this file mid-edit would otherwise
      // put the old text back under the caret.
      const name = untrack(() => file.name);
      el.textContent = name;
      el.focus();
      // Select all of it, so typing replaces the name outright.
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };
  }

  /** Ends the edit, keeping what was typed unless `commit` is false. A blank
   *  name keeps the old one. Answers where focus should go back to. */
  function endRename(el: HTMLElement, commit: boolean): FocusTarget {
    const file = renaming;
    if (!file) return null;
    if (commit) workspace.renameFile(file, el.textContent ?? "");
    renaming = null;
    const target = returnTo;
    returnTo = null;
    return target;
  }

  function onrenamekeydown(e: KeyboardEvent) {
    // The tab's own keys (arrows, F2) mean nothing while its name is text.
    e.stopPropagation();
    if (e.key !== "Enter" && e.key !== "Escape") return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    // The edit is over before focus moves, so the label's blur, which is
    // otherwise how a click elsewhere commits, finds nothing left to do.
    if (!restoreFocus(endRename(el, e.key === "Enter"))) el.blur();
  }

  /** A name is one line: a pasted newline becomes a space. */
  function onrenamepaste(e: ClipboardEvent) {
    e.preventDefault();
    const text = (e.clipboardData?.getData("text/plain") ?? "").replace(/\s*[\r\n]+\s*/g, " ");
    document.execCommand("insertText", false, text);
  }

  function close(file: SqlFile) {
    if (file.content.trim() && !confirm(`Delete "${file.name}"? This cannot be undone.`)) return;
    workspace.deleteFile(file);
  }

  function ontabkeydown(e: KeyboardEvent, file: SqlFile, index: number) {
    if (e.key === "F2") {
      e.preventDefault();
      startRename(file, e.currentTarget as HTMLElement);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = workspace.files[index + (e.key === "ArrowRight" ? 1 : -1)];
      if (!next) return;
      workspace.openFile(next);
      void tick().then(() =>
        strip?.querySelector<HTMLElement>(`[data-file="${CSS.escape(next.id)}"]`)?.focus()
      );
    }
  }

  function ondragover(e: DragEvent, index: number) {
    if (!dragging) return;
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dropAt = e.clientX < box.left + box.width / 2 ? index : index + 1;
  }

  function ondrop(e: DragEvent) {
    e.preventDefault();
    if (dragging && dropAt !== null) {
      const from = workspace.files.indexOf(dragging);
      // Removing the tab first shifts every gap after it one to the left.
      workspace.moveFile(dragging, dropAt > from ? dropAt - 1 : dropAt);
    }
    dragging = null;
    dropAt = null;
  }
</script>

<div class="rail">
  <div
    class="tabs"
    role="tablist"
    aria-label="Files"
    bind:this={strip}
    onpointerdowncapture={notefocus}
  >
    {#each workspace.files as file, i (file.id)}
      {@const active = file === workspace.activeFile}
      <div
        class="tab"
        class:active
        class:dragging={file === dragging}
        class:renaming={file === renaming}
        class:drop-before={dropAt === i && dragging !== null}
        class:drop-after={dropAt === i + 1 && i === workspace.files.length - 1 && dragging !== null}
        role="tab"
        aria-selected={active}
        tabindex={active ? 0 : -1}
        data-file={file.id}
        style:--name={measure ? `${Math.ceil(measure(file.name))}px` : undefined}
        title={file.name}
        draggable={renaming !== file}
        onclick={() => workspace.openFile(file)}
        ondblclick={() => startRename(file, focusBefore)}
        onauxclick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            close(file);
          }
        }}
        onkeydown={(e) => {
          if (e.target === e.currentTarget) ontabkeydown(e, file, i);
        }}
        ondragstart={(e) => {
          dragging = file;
          e.dataTransfer?.setData("text/plain", file.name);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        }}
        ondragover={(e) => ondragover(e, i)}
        {ondrop}
        ondragend={() => {
          dragging = null;
          dropAt = null;
        }}
      >
        {#if renaming === file}
          <span
            class="name editing"
            contenteditable="plaintext-only"
            role="textbox"
            tabindex="-1"
            aria-label="File name"
            spellcheck="false"
            {@attach editable(file)}
            onkeydown={onrenamekeydown}
            onpaste={onrenamepaste}
            onblur={(e) => void endRename(e.currentTarget, true)}
            onclick={(e) => e.stopPropagation()}
            ondblclick={(e) => e.stopPropagation()}
          ></span>
        {:else}
          <span class="name">{file.name}</span>
        {/if}
        <button
          class="close"
          tabindex="-1"
          title="Delete file"
          aria-label="Delete {file.name}"
          onclick={(e) => {
            e.stopPropagation();
            close(file);
          }}
          ondblclick={(e) => e.stopPropagation()}
        >
          <X size={12} />
        </button>
      </div>
    {/each}
  </div>

  <button
    class="chip square new"
    title="New file"
    aria-label="New file"
    onclick={() => workspace.createFile()}
    {@attach snapToPixels}
  >
    <Plus size={14} />
  </button>

  <span class="fill"></span>

  {#if workspace.saveFailed}
    <span
      class="unsaved"
      title="A save failed and is being retried. Your edits are only in this tab until it succeeds."
    >
      <CloudOff size={14} />
      Not saved
    </span>
  {/if}
</div>

<style>
  /* Rounded tabs standing up out of the rail; the open one is outlined and
     runs on into the editor below it. The strip starts 3px down and runs 1px
     over the rail's rule, so a tab's middle — where its name is centred —
     is 2px below the rail's. That is on purpose: the eye centres the open
     tab's name in its outline, and dead on the rail's centre it read high. */
  .rail {
    gap: 2px;
    padding-left: 6px;
    align-items: stretch;
  }

  .rail > .chip,
  .rail > .unsaved {
    align-self: center;
  }

  /* Level with the names: a margin on one side of a centred item moves it by
     half the margin. */
  .rail > .new {
    margin-top: 4px;
  }

  .tabs {
    display: flex;
    min-width: 0;
    margin-bottom: -1px;
    padding-top: 3px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  /* No change of weight between active and not: a bold active tab is wider,
     and every switch nudged the tabs after it sideways. Tabs give up width
     before the strip scrolls, the way a browser's do, so five files in a
     narrow pane are five names cut short rather than three and a half. */
  .tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 1 auto;
    /* A squeezed tab stops at 8em, but one whose name is shorter than that
       stops at its own width: a flat 8em held a short name's tab open with
       the gap after its close button. CSS has no min() of a length and the
       content's own width, so the name's width is measured (`--name`) and
       the rest of the content box is the gap and the close button. */
    min-width: min(8em, calc(var(--name, 8em) + 6px + 16px));
    max-width: 16em;
    padding: 0 4px 0 12px;
    border: 1px solid transparent;
    border-bottom-color: var(--line-strong);
    border-radius: var(--r) var(--r) 0 0;
    color: var(--fg-2);
    cursor: pointer;
    user-select: none;
  }

  .tab:hover,
  .tab.active {
    color: var(--fg);
  }

  .tab:hover:not(.active) {
    background: var(--s2);
  }

  .tab.active {
    background: var(--s0);
    border-color: var(--line-strong);
    border-bottom-color: var(--s0);
  }

  /* A short rule between tabs, centred on the names, which steps aside
     wherever a tab draws its own ground: beside the open one and the one
     under the pointer, and after the last, since the + is not a tab. */
  .tab::after {
    content: "";
    position: absolute;
    top: 8px;
    bottom: 8px;
    right: 0;
    width: 1px;
    background: var(--line-strong);
  }

  .tab:is(.active, :hover, :last-child, :has(+ .active), :has(+ :hover))::after {
    display: none;
  }

  .tab:focus-visible {
    outline: 2px solid var(--accent-line);
    outline-offset: -2px;
  }

  .tab.dragging {
    opacity: 0.5;
  }

  .tab.drop-before {
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .tab.drop-after {
    box-shadow: inset -2px 0 0 var(--accent);
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Editing draws nothing of its own: the label is the same text in the same
     place, with a caret in it. A name the tab had cut short is shown whole
     while it is edited, and the tab makes room for it, since what is hidden
     behind an ellipsis cannot be edited. */
  .tab.renaming {
    flex-shrink: 0;
    min-width: 0;
    max-width: none;
  }

  .name.editing {
    overflow: visible;
    text-overflow: clip;
    outline: none;
    cursor: text;
    user-select: text;
    caret-color: var(--accent);
  }

  /* The selection in the app's own colours rather than the system's, which
     some desktop themes draw as text the colour of the ground behind it — so
     the name selected on entry looked as if it had been wiped. */
  .name.editing::selection {
    background: var(--accent-line);
    color: var(--fg);
  }

  /* Shown on the open tab and on whichever is under the pointer, so the
     strip is not a row of crosses. Hidden rather than removed, so a tab is
     the same width with the pointer over it as without. */
  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: var(--r-kbd);
    background: transparent;
    color: var(--fg-3);
    cursor: pointer;
    visibility: hidden;
  }

  .tab.active .close,
  .tab:hover .close {
    visibility: visible;
  }

  .close:hover {
    background: var(--s3);
    color: var(--fg);
  }

  /* Shown only once a save has failed and is being retried: the half-second
     between a keystroke and its save is not worth a flicker. */
  .unsaved {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    color: var(--error);
    font-size: var(--text-sm);
  }
</style>
