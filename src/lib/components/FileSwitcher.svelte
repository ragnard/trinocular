<script lang="ts">
  import type { SqlFile, Workspace } from "$lib/State.svelte";
  import { Database, FileText, Plus } from "@lucide/svelte";

  interface Connection {
    id: string;
    name: string;
  }

  interface Props {
    workspace: Workspace;
    connections: Connection[];
    onclose: () => void;
  }

  let { workspace, connections, onclose }: Props = $props();

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

  function connectionName(file: SqlFile): string {
    return connections.find((c) => c.id === file.connectionId)?.name || file.connectionId;
  }

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
          <FileText size={16} />
          <span class="name">{file.name}</span>
          <span class="connection"><Database size={12} />{connectionName(file)}</span>
        </button>
      {/each}

      <button
        bind:this={newRow}
        class="row new"
        class:selected={index === matches.length}
        onclick={() => choose(matches.length)}
        onmouseenter={() => (index = matches.length)}
      >
        <Plus size={16} />
        <span class="name">New file</span>
      </button>
    </div>

    <div class="hints">
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
    background: rgba(0, 0, 0, 0.45);
  }

  .palette {
    margin-top: 7em;
    width: min(35em, calc(100vw - 2em));
    height: fit-content;
    max-height: calc(100vh - 12em);
    display: flex;
    flex-direction: column;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }

  .query {
    padding: 0.5em 0.75em;
    border-bottom: 1px solid var(--border);
  }

  .query input {
    width: 100%;
    border: none;
    background: transparent;
    color: var(--text-0);
    font: inherit;
    padding: 0.25em 0;
  }

  .query input:focus {
    outline: none;
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0.25em 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.5em;
    width: 100%;
    padding: 0.4em 0.9em;
    border: none;
    background: transparent;
    color: var(--text-0);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .row :global(svg) {
    color: var(--text-2);
    flex: none;
  }

  .row.selected {
    background: var(--bg-focus);
  }

  .row.new {
    border-top: 1px solid var(--border);
    margin-top: 0.25em;
    padding-top: 0.5em;
    color: var(--text-2);
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
    gap: 0.25em;
    flex: none;
    color: var(--text-2);
    font-size: var(--font-sm);
  }

  .hints {
    display: flex;
    gap: 1em;
    padding: 0.4em 0.9em;
    border-top: 1px solid var(--border);
    background: var(--bg-0);
    color: var(--text-2);
    font-size: var(--font-sm);
  }

  .hints span {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
  }

  kbd {
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-1);
    padding: 0.05em 0.35em;
    font: inherit;
    font-size: 0.85em;
  }
</style>
