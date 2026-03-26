<script lang="ts">
  import type { Workspace } from "$lib/State.svelte";
  import Editor from "$lib/monaco/Editor.svelte";
  import { StaticMetadataProvider } from "monaco-language-trino";
  import * as monaco from "monaco-editor";

  import Trino, { type QueryResult } from "$lib/trino";
  import { SplitPane } from "./split-pane";
  import Query from "./Query.svelte";

  let { workspace = $bindable() }: { workspace: Workspace } = $props();

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

SELECT row(array[row('foo', i), row('bar', i+2)], array[1, 2, 3, 4, 5]) as complex
from table(sequence(1, 100)) as t(i);

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
</script>

<main>
  <div class="topbar">
    <div class="brand"><span class="logo">🐷</span> Tryne</div>
  </div>

  <div class="workspace">
    <SplitPane type="vertical" min="200px" pos="300px" --color="var(--border)" --thickness="20px">
      {#snippet a()}
        <div class="editor">
          <Editor
            value={query}
            metadataProvider={new StaticMetadataProvider()}
            markers={editorMarkers}
            onexecutesql={handleExecuteSql}
          />
        </div>
      {/snippet}

      {#snippet b()}
        <div class="results">
          {#if workspace.currentQuery}
            <Query query={workspace.currentQuery} />
          {:else}
            <div class="no-query">
              <span>Nothing here yet...</span>
            </div>
          {/if}
        </div>
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
  }

  .topbar {
    /* height: 32px; */
    background-color: var(--bg-0);
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: row;
    align-items: center;
    padding: 0.4em 0.4em;
  }

  .workspace {
    min-height: 0;
    overflow: hidden;
    flex: 1;
  }

  .editor {
    /*height: 50%;*/
  }

 .results {
     display: flex;
     border-top: 1px solid var(--border);
  }

 .logo {
     background: white;
     border-radius: 50%;
     border: 1px solid var(--border);
     display: inline-flex;
     align-items: center;
     justify-content: center;
     width: 2em;
     height: 2em;
     font-size: 1.0em;
     animation: spin 37s linear infinite;
  }

  @keyframes spin {
     /* spin at ~5s */
     13% { transform: rotate(0deg); }
     14% { transform: rotate(360deg); }
     /* spin at ~12s */
     32% { transform: rotate(360deg); }
     33% { transform: rotate(720deg); }
     /* spin at ~20s */
     53% { transform: rotate(720deg); }
     54% { transform: rotate(1080deg); }
     /* spin at ~28s */
     75% { transform: rotate(1080deg); }
     76% { transform: rotate(1440deg); }
     /* spin at ~34s */
     91% { transform: rotate(1440deg); }
     92% { transform: rotate(1800deg); }
     100% { transform: rotate(1800deg); }
  }

 .no-query {
     display: flex;
     flex: 1;
     align-items: center;
     justify-content: center;
     height: 100%;
  }

</style>
