<script lang="ts">
  import type { Workspace } from "$lib/State.svelte";
  import Editor from "$lib/monaco/Editor.svelte";
  import { StaticMetadataProvider } from "monaco-language-trino";
  import * as monaco from "monaco-editor";
  import { onMount } from "svelte";

  import Trino, { type QueryResult } from "$lib/trino";
  import { SplitPane } from "./split-pane";
  import Query from "./Query.svelte";
  import Logo from "./Logo.svelte";
  import DataViewer from "./DataViewer.svelte";
  import type { Selection } from "./table/types";
  import Menu from "./Menu.svelte";

  let { workspace = $bindable() }: { workspace: Workspace } = $props();

  let selection: Selection | null = $state(null);

  let theme: "light" | "dark" = $state("light");
  let manualOverride = $state(false);

  onMount(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    theme = mq.matches ? "dark" : "light";

    const handler = (e: MediaQueryListEvent) => {
      if (!manualOverride) {
        theme = e.matches ? "dark" : "light";
      }
    };
    mq.addEventListener("change", handler);

    return () => mq.removeEventListener("change", handler);
  });

  $effect(() => {
    document.documentElement.dataset.theme = theme;
  });

  function toggleTheme() {
    manualOverride = true;
    theme = theme === "light" ? "dark" : "light";
  }

  let statementStartLine = $state(1);

  const editorMarkers: monaco.editor.IMarkerData[] = $derived.by(() => {
    const error = workspace.query?.error;
    if (!error?.errorLocation) return [];
    return [
      {
        startLineNumber: error.errorLocation.lineNumber + statementStartLine - 1,
        startColumn: error.errorLocation.columnNumber,
        endLineNumber: error.errorLocation.lineNumber + statementStartLine - 1,
        endColumn: error.errorLocation.columnNumber + 1,
        message: error.message,
        severity: monaco.MarkerSeverity.Error
      }
    ];
  });

  const query = `SELECT * from tpch.sf1.customer limit 50;

SELECT custkey, count(*) from tpch.sf10.orders group by 1 order by 2 desc limit 50;

SELECT
  row(array[row('foo', i), row('bar', i+2)], array[1, 2, 3, 4, 5]) as complex,
  row(i, i*2, i*4, 'oink') as bleh,
  array[row('alice', i), row('bob', i*2), row('cecil', i-2)] as bloh
from table(sequence(1, 100)) as t(i);

select * from iceberg.censys.host_ipv4 limit 50;

select * from iceberg.censys.web limit 50;


  `;

  async function handleExecuteSql(sql: string, startLine: number) {
    console.log("Execute SQL:", sql);
    statementStartLine = startLine;

    const trino: Trino = Trino.create({
      server: "http://localhost:5173/api/trino/test"
      // catalog: 'tpcds',
      // schema: 'sf100000',
      // auth: new BasicAuth('test'),
    });

    workspace.executeQuery(trino, sql);
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });

  function decodeBinary(bytes: Uint8Array): string {
    try {
      let text = decoder.decode(bytes);

      if (text.startsWith('{"')) {
        try {
          let json = JSON.parse(text);
          return JSON.stringify(json, null, 2);
        } catch (error) {}
      }
      return text;
    } catch (error) {
      return "0x" + bytes.toHex();
    }
  }
</script>

{#snippet menu()}
  <div class="menu"><Menu {workspace} /></div>
{/snippet}

{#snippet dataviewer()}
  <div class="data-viewer">
    <DataViewer {selection}>
      {#snippet formatValue(field, value)}
        {#if value === "null"}
          <span>[null]</span>
        {:else if field.dataType === "binary"}
          <pre>{decodeBinary(value)}</pre>
        {:else}
          <span>{value}</span>
        {/if}
      {/snippet}
    </DataViewer>
  </div>
{/snippet}

{#snippet editor()}
  <div class="editor">
    <Editor
      value={query}
      metadataProvider={new StaticMetadataProvider()}
      markers={editorMarkers}
      onexecutesql={handleExecuteSql}
      {theme}
    />
  </div>
{/snippet}

{#snippet results()}
  <div class="results">
    {#if workspace.latestQuery}
      <Query query={workspace.latestQuery} bind:selection />
    {:else}
      <div class="no-query">
        <span>Nothing here yet...</span>
      </div>
    {/if}
  </div>
{/snippet}


<main>
  <div class="topbar">
    <div class="brand"><Logo /> Tryne</div>
    <div style="flex: 1;"></div>
    <button class="theme-toggle" onclick={toggleTheme} title="Toggle dark mode">
      {theme === "light" ? "🌙" : "☀️"}
    </button>
    <div class="user">$user_id</div>
  </div>

  <div class="workspace">
    <SplitPane
      type="horizontal"
      min="10%"
      max="90%"
      pos="25%"
      --color="var(--border-dark)"
      --border-width="2px"
      --thickness="20px"
      a={menu}
    >
      {#snippet b()}
        <SplitPane
          type="horizontal"
          min="10%"
          max="90%"
          pos="75%"
          --color="var(--border-dark)"
          --border-width="2px"
          --thickness="20px"
          b={dataviewer}
        >
          {#snippet a()}
            <SplitPane
              type="vertical"
              min="10%"
              max="90%"
              pos="33%"
              --color="var(--border-dark)"
              --border-width="2px"
              --thickness="20px"
              a={editor}
              b={results}
            ></SplitPane>
          {/snippet}
        </SplitPane>
      {/snippet}
    </SplitPane>
  </div>
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    background-color: var(--bg-1);
  }

  pre {
    white-space: pre-line;
    /* font-family: '';*/
  }

  .topbar {
    /* height: 32px; */
    background-color: var(--bg-0);
    border-bottom: 2px solid var(--border-dark);
    display: flex;
    flex-direction: row;
    align-items: center;
    padding: 0.4em 0.4em;
  }

  .menu {
    background-color: var(--bg-0);
  }

  .workspace {
    min-height: 0;
    overflow: hidden;
    flex: 1;
  }

  .editor {
    /* border-bottom: 2px solid var(--border-dark); */
  }

  .results {
    display: flex;
  }

  .data-viewer {
    /* border-left: 0px solid var(--border-dark); */
  }

  .theme-toggle {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 1em;
    padding: 0.2em 0.4em;
    margin-right: 0.5em;
  }

  .no-query {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    height: 100%;
  }
</style>
