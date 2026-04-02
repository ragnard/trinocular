<script lang="ts">
  import type { Query, Workspace } from "$lib/State.svelte";
  import {
    ChevronRight,
    CircleAlert,
    CircleStop,
    CircleX,
    LoaderCircle,
    Settings
  } from "@lucide/svelte";
  import Logo from "./Logo.svelte";
  import { page } from "$app/state";

  interface Props {
    workspace: Workspace;
    theme: "light" | "dark";
    onToggleTheme: () => void;
  }

  let { workspace, theme, onToggleTheme }: Props = $props();

  let userId = $derived(page.data.userId);
</script>

<div class="menu-container">
  <div class="menu-top">
    <div class="brand"><Logo /> Oink</div>
  </div>

  <div class="menu-content">
    <details open>
      <summary>
        <ChevronRight size={14} class="toggle" />
        <span class="title">Connection</span>
        <span class="fill"></span>
        <button class="settings"><Settings size={16} /></button>
      </summary>
      <div class="details connection-select">
        <select
          value={workspace.connectionId}
          onchange={(e) => workspace.setConnection(e.currentTarget.value)}
        >
          {#each page.data.connections as conn (conn.id)}
            <option value={conn.id}>{conn.name}</option>
          {/each}
        </select>
      </div>
    </details>

    <details open>
      <summary>
        <ChevronRight size={14} class="toggle" />
        <span class="title">Queries</span>
        <span class="fill"></span>
        <button class="settings"><Settings size={16} /></button>
      </summary>
      <div class="details query-list">
        {#if workspace.queries.length}
          {#each workspace.queries as query (query.id)}
            <div class="query">
              <span>
                <button onclick={(_ev) => workspace.setActiveQuery(query)}
                  >Query #{query.id}
                  {#if query.rowCount}
                    <span class="stats">({query.rowCount} rows in {query.elapsedTimeSeconds}s)</span
                    >
                  {/if}
                </button>
              </span>
              <div class="actions">
                {#if query?.running}
                  <LoaderCircle size={16} class="spin" />
                  <button onclick={(_ev) => query.cancel()}><CircleStop size={16} /></button>
                {/if}
                {#if query?.error}
                  <button><CircleAlert size={16} /></button>
                {/if}
                {#if query?.completed}
                  <button onclick={(_ev) => workspace.removeQuery(query)}
                    ><CircleX size={16} /></button
                  >
                {/if}
              </div>
            </div>
          {/each}
        {:else}
          <span>No queries yet</span>
        {/if}
      </div>
    </details>

    <details open>
      <summary>
        <ChevronRight size={14} class="toggle" />
        <span class="title" >Browse</span>
        <span class="fill"></span>
        <button class="settings"><Settings size={16} /></button>
      </summary>
      <div class="details">TODO</div>
    </details>
  </div>

  <div class="menu-bottom">
    <button class="theme-toggle" onclick={onToggleTheme} title="Toggle dark mode">
      {theme === "light" ? "🌙" : "☀️"}
    </button>
    <div class="user">{userId}</div>
  </div>
</div>

<style>
  .menu-container {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .menu-top {
    padding: 0.6em 1em;
    border-bottom: 1px solid var(--border);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.4em;
    font-weight: bold;
  }

  .menu-content {
    display: flex;
    flex-direction: column;
    /* gap: 2em; */
    flex: 1;
    overflow: auto;
    padding: 1em;
  }

  .menu-bottom {
    border-top: 1px solid var(--border);
    padding: 0.6em 1em;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.5em;
  }

  .theme-toggle {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 1em;
    padding: 0.2em 0.4em;
  }

  .user {
    font-size: 0.85em;
    color: var(--text-2);
  }

  details[open] > summary :global(.toggle) {
    transform: rotate(90deg);
  }

  details {
    summary {
      display: flex;
      list-style: none;
      flex-direction: row;
      align-items: center;
      margin-bottom: 1em;
      cursor: pointer;
      justify-content: space-between;
      color: var(--text-2);

      :global(.toggle) {
        transition: transform 0.15s ease;
        margin-right: 0.25em;
      }

      .title {
        font-size: 0.8em;
        font-weight: bold;
        text-transform: uppercase;
      }

      .fill {
        flex: 1;
      }

    }

    .details {
      margin-bottom: 2em;
      margin-left: 0.25em;
    }


    button {
      padding: 0;
      margin: 0;
      border: none;
      background: transparent;
      color: gray;
      cursor: pointer;

      &:hover {
        color: var(--bg-text);
      }
    }

    .query-list {
      display: flex;
      flex-direction: column;
    }

    .connection-select {
      select {
        width: 100%;
        padding: 0.35em 0.5em;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--bg-1, inherit);
        color: inherit;
        font-size: 0.9em;
        cursor: pointer;
        /*appearance: none;*/
      }
    }

    .query {
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      padding: 0.25em 0.25em;
      margin-left: -0.25em;
      margin-right: -0.25em;

      &:hover {
        background-color: lightgrey;
        border-radius: 4px;
      }

      button {
        color: black;
        cursor: pointer;
        text-decoration: none;
      }

      .stats {
        font-size: 0.8em;
        color: gray;
      }

      .actions {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 0.25em;
      }
    }
  }
</style>
