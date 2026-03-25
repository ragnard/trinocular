<script lang="ts">
  import type { Workspace } from "$lib/State.svelte";
  import Editor from "$lib/monaco/Editor.svelte";
  import { StaticMetadataProvider } from "monaco-language-trino";

  import Trino, { type QueryResult } from "$lib/trino";
  import { SplitPane } from "./split-pane";
  import Query from "./Query.svelte";

  let { workspace = $bindable() }: { workspace: Workspace } = $props();

  const query = "SELECT * from tpch.sf1.customer limit 50;\n\n\n";

  async function handleExecuteSql(sql: string) {
    console.log("Execute SQL:", sql);

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
    <span>Trinette</span>
  </div>
  <div class="workspace">
    <SplitPane type="vertical" min="200px" pos="300px" --color="var(--border)" --thickness="20px">
      {#snippet a()}
        <div class="editor">
          <Editor
            value={query}
            metadataProvider={new StaticMetadataProvider()}
            onexecutesql={handleExecuteSql}
          />
        </div>
      {/snippet}

      {#snippet b()}
        <div class="results">
          {#if workspace.currentQuery}
            <Query query={workspace.currentQuery} />
          {:else}
            <span>No query...</span>
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
    background-color: #f0f0f0;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: row;
    align-items: center;
    padding: 0.25em 0.5em;
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
    overflow: scroll;
  }
</style>
