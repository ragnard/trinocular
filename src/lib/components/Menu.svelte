<script lang="ts">
  import type { Query, Workspace } from "$lib/State.svelte";
  import {
    ChevronDown,
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
        Queries
        <button class="settings"><Settings size={16} /></button>
      </summary>
      <div class="query-list">
        {#if workspace.queries.length}
          {#each workspace.queries as query (query.id)}
            <div class="query">
              <span>
                <a onclick={(_ev) => workspace.setActiveQuery(query)}
                  >Query #{query.id}
                  {#if query.rowCount}
                    <span class="stats">({query.rowCount} rows in {query.elapsedTimeSeconds}s)</span
                    >
                  {/if}
                </a>
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
        Data Sources
        <button class="settings"><Settings size={16} /></button>
      </summary>
      <div>TBD</div>

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
    flex: 1;
    overflow: auto;
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

  details {
    padding: 1em;

    summary {
      list-style: none;
      display: flex;
      flex-direction: row;
      align-items: center;
      font-size: 0.8em;
      color: var(--text-2);
      text-transform: uppercase;
      margin-bottom: 1em;
      cursor: pointer;
      justify-content: space-between;
      font-weight: bold;
      padding: 0.25em;
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

    .query {
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      padding: 0.25em 0.25em;

      &:hover {
        background-color: lightgrey;
        border-radius: 4px;
      }

      a {
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
