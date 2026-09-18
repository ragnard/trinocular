<script lang="ts">
  /**
   * A chip that opens a menu. Three of them exist — the document's file, the
   * data browser's connection, and the results pane's Save — and until this component they
   * were three implementations of the same thing that had already drifted
   * apart twice: once in what the trigger looked like, once in how the menu
   * was dismissed.
   *
   * What the caller supplies is the menu's *contents*, as a snippet, because
   * that is the part that genuinely differs: one is a list of actions with a
   * destructive one at the bottom, one is a list of choices with a note under
   * it, one is a list of file formats. What the caller does not get to choose
   * is the surface it lands on or how it goes away — that is `Menu`, which the
   * inspector's per-field picker shares rather than being a chip it is not.
   */
  import type { Component, Snippet } from "svelte";
  import { ChevronDown } from "@lucide/svelte";
  import Menu from "./Menu.svelte";

  interface Props {
    label: string;
    /** A lucide icon component, rendered at the chip's leading edge. */
    icon?: Component<any>;
    title?: string;
    disabled?: boolean;
    /** For a chip that names the thing its rail is about rather than describing it. */
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
  let open = $state(false);
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

<Menu {id} anchor={trigger} {menuWidth} onopenchange={(o) => (open = o)} {menu} />

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
</style>
