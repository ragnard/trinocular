<script lang="ts">
  import type { SqlFile, Workspace } from "$lib/State.svelte";
  import { FileText, HardDrive, Plus } from "@lucide/svelte";

  interface Props {
    workspace: Workspace;
    onclose: () => void;
  }

  let { workspace, onclose }: Props = $props();

  /**
   * The file list used to live in the drawer, where it competed for height
   * with the schema tree. It is navigation, which is a thing you do in bursts
   * — so it is a switcher you summon, not a list you keep.
   */
  let query = $state("");
  let index = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let rows: HTMLButtonElement[] = $state([]);
  let newRow: HTMLButtonElement | undefined = $state();

  let matches: SqlFile[] = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return workspace.files;
    return workspace.files.filter((f) => f.name.toLowerCase().includes(needle));
  });

  // Every keystroke re-ranks the list, so the selection goes back to the top
  // rather than pointing at whatever now happens to sit at that offset —
  // which, once a query narrowed the list, was reliably the "New file" row.
  $effect(() => {
    void query;
    index = 0;
  });

  // The list can also shrink without the query changing (a file deleted
  // elsewhere), leaving the selection past its end.
  $effect(() => {
    if (index > matches.length) index = matches.length;
  });

  // Arrow keys have to bring their row with them once the list scrolls.
  $effect(() => {
    (rows[index] ?? (index === matches.length ? newRow : undefined))?.scrollIntoView({
      block: "nearest"
    });
  });

  /** The "New file" row sits one past the matches and is always reachable. */
  function choose(at: number) {
    if (at === matches.length) {
      workspace.createFile();
    } else {
      const file = matches[at];
      if (!file) return;
      workspace.openFile(file);
    }
    onclose();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onclose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      index = index >= matches.length ? 0 : index + 1;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      index = index <= 0 ? matches.length : index - 1;
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(index);
    }
  }

  $effect(() => {
    input?.focus();
  });
</script>

<!-- A click lands on the scrim itself only outside the palette, so the
     palette needs no handler of its own to keep from dismissing itself. -->
<div
  class="scrim"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
>
  <div class="palette" role="dialog" aria-label="Switch file" tabindex="-1">
    <div class="query">
      <input
        bind:this={input}
        bind:value={query}
        type="text"
        placeholder="Go to file&hellip;"
        spellcheck="false"
        {onkeydown}
      />
    </div>

    <div class="list">
      {#each matches as file, i (file.id)}
        <button
          bind:this={rows[i]}
          class="row"
          class:selected={i === index}
          onclick={() => choose(i)}
          onmouseenter={() => (index = i)}
        >
          <FileText size={14} />
          <span class="name">{file.name}</span>
          <span class="connection meta"
            ><HardDrive size={12} />{workspace.connectionName(file.connectionId)}</span
          >
        </button>
      {/each}

      <button
        bind:this={newRow}
        class="row new"
        class:selected={index === matches.length}
        onclick={() => choose(matches.length)}
        onmouseenter={() => (index = matches.length)}
      >
        <Plus size={14} />
        <span class="name">New file</span>
      </button>
    </div>

    <div class="hints meta">
      <span><kbd>&#8593;</kbd><kbd>&#8595;</kbd> navigate</span>
      <span><kbd>&#8629;</kbd> open</span>
      <span><kbd>esc</kbd> dismiss</span>
    </div>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    justify-content: center;
    background: var(--scrim);
  }

  .palette {
    display: flex;
    flex-direction: column;
    width: min(36em, calc(100vw - 32px));
    height: fit-content;
    max-height: calc(100vh - 180px);
    margin-top: 96px;
    overflow: hidden;
    background: var(--s1);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-panel);
    box-shadow: var(--shadow);
  }

  .query {
    display: flex;
    flex: none;
    height: var(--h-rail);
    padding: 0 12px;
    border-bottom: 1px solid var(--line-strong);
  }

  .query input {
    width: 100%;
    height: auto;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--fg);
  }

  .query input:focus-visible {
    outline: none;
  }

  .list {
    flex: 1;
    min-height: 0;
    padding: 4px 0;
    overflow: auto;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: var(--h-row);
    padding: 0 12px;
    border: none;
    background: transparent;
    color: var(--fg);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .row :global(svg) {
    flex: none;
    color: var(--fg-3);
  }

  .row.selected {
    background: var(--accent-bg);
  }

  .row.selected :global(svg) {
    color: var(--accent);
  }

  .row.new {
    margin-top: 4px;
    border-top: 1px solid var(--line);
    color: var(--fg-2);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .connection {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
  }

  .hints {
    display: flex;
    gap: 16px;
    flex: none;
    height: var(--h-tree);
    align-items: center;
    padding: 0 12px;
    border-top: 1px solid var(--line);
  }

  .hints span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
</style>
