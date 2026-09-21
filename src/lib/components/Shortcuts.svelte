<script lang="ts">
  /**
   * The keyboard shortcuts, as a reference card: one section per surface,
   * keys on the left and what they do on the right, on one screen with no
   * scrolling. The list is `SHORTCUTS` in `$lib/shortcuts`, so a new binding
   * is a line there and nothing here.
   *
   * The sections flow into two columns rather than sitting in a grid, since
   * they are of different lengths and a column layout balances them without
   * anyone deciding which goes where. The section for the pane that had
   * focus when the card opened is tinted the way the running statement is:
   * you pressed `?` in the table, so the table's keys are the ones you were
   * after.
   */
  import { tick } from "svelte";
  import { X } from "@lucide/svelte";
  import { SHORTCUTS, formatKeys, type Pane } from "$lib/shortcuts";

  interface Props {
    /** The pane that had focus when the card was asked for, if any. */
    current?: Pane;
    onclose: () => void;
  }

  let { current, onclose }: Props = $props();

  // A modal dialog focuses its first focusable descendant, which here is the
  // close button, and a card that opens with a focus ring on its `✕` looks
  // like it is asking to be closed. The card takes focus itself (after
  // `tick()`, so it lands after `showModal()` has done its own focusing),
  // and Escape and Tab go on working from there.
  let root: HTMLDivElement | undefined = $state();
  $effect(() => {
    void tick().then(() => root?.focus());
  });
</script>

<div class="shortcuts" bind:this={root} tabindex="-1">
  <div class="rail">
    <span class="title">Keyboard shortcuts</span>
    <span class="fill"></span>
    <button class="chip square" onclick={onclose} title="Close (Esc)">
      <X size={14} />
    </button>
  </div>

  <div class="body">
    {#each SHORTCUTS as section (section.title)}
      <section class:current={section.pane !== undefined && section.pane === current}>
        <h2 class="meta">{section.title}</h2>
        <dl>
          {#each section.items as item (item.label)}
            <dt>
              {#each item.keys as combo (combo)}
                <kbd>{formatKeys(combo)}</kbd>
              {/each}
            </dt>
            <dd>{item.label}</dd>
          {/each}
        </dl>
      </section>
    {/each}
  </div>
</div>

<style>
  .shortcuts {
    display: flex;
    flex-direction: column;
    width: min(60em, calc(100vw - 48px));
    outline: none;
  }

  /* As the inspector's rail: a square chip at the end overhangs the inset by
     its own padding, so its icon lands where a bare rail icon would. */
  .rail {
    padding-right: 6px;
  }

  .title {
    font-weight: 600;
  }

  .body {
    padding: 12px 16px 16px;
    column-count: 2;
    column-gap: 24px;
  }

  @media (max-width: 40em) {
    .body {
      column-count: 1;
    }
  }

  section {
    break-inside: avoid;
    margin-bottom: 12px;
    padding-left: 8px;
    border-left: 2px solid transparent;
  }

  section.current {
    border-left-color: var(--accent);
  }

  section.current h2 {
    color: var(--accent);
  }

  h2 {
    margin: 0 0 4px;
    font-weight: 600;
  }

  dl {
    display: grid;
    grid-template-columns: 8em 1fr;
    gap: 0 12px;
    margin: 0;
  }

  dt,
  dd {
    margin: 0;
    line-height: var(--h-tree);
  }

  dt {
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }

  dd {
    color: var(--fg-2);
  }
</style>
