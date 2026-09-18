<script lang="ts">
  /**
   * The surface a menu lands on, and how it goes away. `Dropdown` is a chip
   * plus one of these; the inspector is a few hundred rows sharing one of
   * these, which is why the two are no longer the same component: a `Dropdown`
   * per field would put a popover element behind every row of every selected
   * document, for a menu only one of them can have open.
   *
   * Dismissal is the platform's: a native popover closes on Escape and on a
   * click anywhere else, which is what the hand-rolled version was reaching
   * for with a full-window backdrop div and a window keydown handler. The top
   * layer also means a menu is never clipped by a pane that has to hide its
   * overflow. The one thing added is *when* a click outside counts: the
   * platform waits for the pointer to come back up, and only if it went down
   * outside too, so that a drag out of a popover -- selecting its text --
   * does not lose it. A menu of buttons has nothing to drag, and the wait
   * reads as lag, so this closes on the pointer going down, the way native
   * menus do; an item still fires on the click, on the way back up.
   *
   * Opening is the platform's too — a trigger carries `popovertarget={id}` and
   * toggles this without asking. That matters for the inspector, where every
   * row's picker points at this one menu: a click on another row's button
   * light-dismisses the menu and then re-opens it, and the browser is what
   * gets the ordering of those two right. All this component needs to know is
   * which element to measure against, which the trigger sets before the toggle
   * reaches it.
   */
  import type { Snippet } from "svelte";

  interface Props {
    /** What a trigger points its `popovertarget` at. */
    id: string;
    /** The element to place against. Set it before opening. */
    anchor?: HTMLElement | null;
    menuWidth?: string;
    onopenchange?: (open: boolean) => void;
    /** The menu's contents. `close` is for anything that is not a button. */
    menu: Snippet<[() => void]>;
  }

  let { id, anchor = null, menuWidth, onopenchange, menu }: Props = $props();

  let panel: HTMLDivElement | undefined = $state();
  let open = $state(false);

  export function close() {
    panel?.hidePopover();
  }

  // Not the anchor: a press on it is a toggle, and closing here would have
  // the click that follows open the menu straight back up.
  $effect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel?.contains(target) || anchor?.contains(target)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  });

  /**
   * The top layer positions against the viewport, so this is measured and
   * placed each time it opens: under the anchor, kept on screen, and flipped
   * above it rather than run off the bottom.
   *
   * Placed from `beforetoggle`, which the browser fires synchronously before
   * it shows the popover, and not from `toggle`, which it queues as a task
   * after — by which time a frame has painted the menu wherever it was last
   * put, or at its default fixed position the first time, and the move to the
   * anchor was a visible jump. A popover that is not open is `display: none`
   * and measures as nothing, so the panel is displayed for the length of this
   * handler and put back; nothing paints in between, since it is all one task.
   */
  function place() {
    if (!anchor || !panel) return;
    const trigger = anchor.getBoundingClientRect();
    panel.style.display = "block";
    const size = panel.getBoundingClientRect();
    panel.style.display = "";
    const below = trigger.bottom + 6;
    const top =
      below + size.height > window.innerHeight - 8 ? trigger.top - 6 - size.height : below;
    panel.style.left = `${Math.max(8, Math.min(trigger.left, window.innerWidth - size.width - 8))}px`;
    panel.style.top = `${Math.max(8, top)}px`;
  }

  function onBeforeToggle(event: ToggleEvent) {
    if (event.newState === "open") place();
  }

  function onToggle(event: ToggleEvent) {
    // Also how a trigger learns it has been dismissed from outside, which is
    // most of the time: it is what keeps a chip drawn as pressed only while
    // its menu is up.
    open = event.newState === "open";
    onopenchange?.(open);
  }

  /**
   * Any button or link in a menu closes it. Captured on the way down, so the
   * menu is already gone by the time the item's own handler runs — one of them
   * opens a `prompt()`, and a menu left standing behind a modal dialog looks
   * stuck.
   */
  function onMenuClick(event: MouseEvent) {
    if ((event.target as HTMLElement).closest("button, a")) close();
  }
</script>

<div
  class="menu"
  {id}
  popover
  bind:this={panel}
  style:min-width={menuWidth}
  onbeforetoggle={onBeforeToggle}
  ontoggle={onToggle}
  onclickcapture={onMenuClick}
>
  {@render menu(close)}
</div>

<style>
  /* Only where it is put — the look is the global `.menu` primitive.

     The sizing is not decoration: a popover is laid out where it is written,
     and a caller can be a component whose container sizes its children. The
     inspector is exactly that — `SplitPane` gives every direct child of a
     section `width: 100%; height: 100%`, which found this the moment a pane
     rendered a menu beside its own root and stretched it over the window. A
     menu is the size of its contents wherever it is opened from. */
  .menu {
    position: fixed;
    inset: auto;
    width: fit-content;
    height: fit-content;
    margin: 0;
  }
</style>
