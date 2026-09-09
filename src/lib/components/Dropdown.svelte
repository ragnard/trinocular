<script lang="ts">
  /**
   * A chip that opens a menu. Three of them exist — the document's file, its
   * connection, and the results pane's Save — and until this component they
   * were three implementations of the same thing that had already drifted
   * apart twice: once in what the trigger looked like, once in how the menu
   * was dismissed.
   *
   * What the caller supplies is the menu's *contents*, as a snippet, because
   * that is the part that genuinely differs: one is a list of actions with a
   * destructive one at the bottom, one is a list of choices with a note under
   * it, one is a list of file formats. What the caller does not get to choose
   * is the surface it lands on or how it goes away.
   *
   * Dismissal is the platform's: a native popover closes on Escape and on a
   * click anywhere else, which is exactly the behaviour the hand-rolled
   * version was reaching for with a full-window backdrop div and a window
   * keydown handler. The top layer also means a menu is never clipped by a
   * pane that has to hide its overflow — the reason the results pane could not
   * use the same absolute positioning the document header does.
   */
  import type { Component, Snippet } from "svelte";
  import { ChevronDown } from "@lucide/svelte";

  interface Props {
    label: string;
    /** A lucide icon component, rendered at the chip's leading edge. */
    icon?: Component<any>;
    title?: string;
    disabled?: boolean;
    /** For the one chip that names the thing rather than describing it. */
    strong?: boolean;
    /** A wider menu, where the contents need it. */
    menuWidth?: string;
    /** The menu's contents. `close` is for anything that is not a button. */
    menu: Snippet<[() => void]>;
  }

  let {
    label,
    icon: Icon,
    title,
    disabled = false,
    strong = false,
    menuWidth,
    menu
  }: Props = $props();

  const id = $props.id();
  let trigger: HTMLButtonElement | undefined = $state();
  let panel: HTMLDivElement | undefined = $state();
  let open = $state(false);

  function close() {
    panel?.hidePopover();
  }

  /**
   * The top layer positions against the viewport, so this is measured and
   * placed each time it opens: under the chip, kept on screen, and flipped
   * above it rather than run off the bottom.
   */
  function place() {
    if (!trigger || !panel) return;
    const chip = trigger.getBoundingClientRect();
    const size = panel.getBoundingClientRect();
    const below = chip.bottom + 6;
    const top = below + size.height > window.innerHeight - 8 ? chip.top - 6 - size.height : below;
    panel.style.left = `${Math.max(8, Math.min(chip.left, window.innerWidth - size.width - 8))}px`;
    panel.style.top = `${Math.max(8, top)}px`;
  }

  function onToggle(event: ToggleEvent) {
    // Also how the chip learns it has been dismissed from outside, which is
    // most of the time: it is what keeps it drawn as pressed only while it is.
    open = event.newState === "open";
    if (open) place();
  }

  /**
   * Any button in a menu closes it. Captured on the way down, so the menu is
   * already gone by the time the item's own handler runs — one of them opens a
   * `prompt()`, and a menu left standing behind a modal dialog looks stuck.
   */
  function onMenuClick(event: MouseEvent) {
    if ((event.target as HTMLElement).closest("button")) close();
  }
</script>

<button
  class="chip"
  class:strong
  bind:this={trigger}
  popovertarget={id}
  aria-pressed={open}
  aria-haspopup="true"
  {disabled}
  {title}
>
  {#if Icon}
    <Icon size={14} />
  {/if}
  <span class="ell">{label}</span>
  <ChevronDown size={12} />
</button>

<div
  class="menu"
  {id}
  popover
  bind:this={panel}
  style:min-width={menuWidth}
  ontoggle={onToggle}
  onclickcapture={onMenuClick}
>
  {@render menu(close)}
</div>

<style>
  .chip {
    max-width: 22em;
  }

  /* The file is the noun; everything else on a rail describes it. Only while
     it is closed, though: an open chip is accent all through — icon, label and
     chevron — and this rule is specific enough to have quietly beaten that. */
  .chip.strong {
    font-weight: 600;
  }

  .chip.strong:not([aria-pressed="true"]) {
    color: var(--fg);
  }

  .chip:disabled {
    color: var(--fg-3);
    background: transparent;
    cursor: default;
  }

  /* Only where it is put — the look is the global `.menu` primitive. */
  .menu {
    position: fixed;
    inset: auto;
    margin: 0;
  }
</style>
