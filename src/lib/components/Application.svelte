<script lang="ts">
  import type { Result as ResultModel, Workspace } from "$lib/State.svelte";
  import Editor from "$lib/monaco/Editor.svelte";
  import * as monaco from "monaco-editor";
  import { onMount } from "svelte";
  import { DelegatingMetadataProvider } from "$lib/catalog/DelegatingMetadataProvider";
  import { TrinoMetadataProvider } from "$lib/catalog/TrinoMetadataProvider";

  import { SplitPane } from "./split-pane";
  import Result from "./Result.svelte";
  import DataViewer from "./DataViewer.svelte";
  import type { Selection } from "./table/types";
  import DocumentHeader from "./DocumentHeader.svelte";
  import FileSwitcher from "./FileSwitcher.svelte";
  import SchemaBrowser from "./SchemaBrowser.svelte";
  import { page } from "$app/state";

  let { workspace = $bindable() }: { workspace: Workspace } = $props();

  let selection: Selection | null = $state(null);
  let switcherOpen = $state(false);

  let connections: { id: string; name: string }[] = $derived(page.data.connections ?? []);
  let connectionId = $derived(workspace.connectionId);

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

  // One delegate per connection, swapped when the active document points
  // somewhere else, so completions describe the cluster it actually runs on.
  const metadataProvider = new DelegatingMetadataProvider(
    new TrinoMetadataProvider(workspace.catalog)
  );

  $effect(() => {
    metadataProvider.delegate = new TrinoMetadataProvider(workspace.catalogFor(connectionId));
  });

  let activeResult: ResultModel | null = $derived(workspace.activeFile?.activeResult ?? null);

  const editorMarkers: monaco.editor.IMarkerData[] = $derived.by(() => {
    const result = activeResult;
    if (!result?.error?.errorLocation) return [];
    return [
      {
        startLineNumber: result.error.errorLocation.lineNumber + result.startLine - 1,
        startColumn: result.error.errorLocation.columnNumber,
        endLineNumber: result.error.errorLocation.lineNumber + result.startLine - 1,
        endColumn: result.error.errorLocation.columnNumber + 1,
        message: result.error.message,
        severity: monaco.MarkerSeverity.Error
      }
    ];
  });
  let saveTimer: ReturnType<typeof setTimeout>;
  function handleEditorChange() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => workspace.persist(), 500);
  }

  function handleExecuteSql(sql: string, startLine: number, anchorId: string, replacesId?: string) {
    workspace.run(sql, startLine, anchorId, replacesId);
  }

  function handleShowResult(result: ResultModel) {
    workspace.showResult(result);
  }

  function handleCancelResult(result: ResultModel) {
    workspace.cancel(result);
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
      return "0x" + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }
  }
</script>

{#snippet browser()}
  <div class="browser"><SchemaBrowser {workspace} {theme} onToggleTheme={toggleTheme} /></div>
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
      file={workspace.activeFile}
      files={workspace.files}
      {metadataProvider}
      markers={editorMarkers}
      onexecutesql={handleExecuteSql}
      onshowresult={handleShowResult}
      oncancelresult={handleCancelResult}
      onchange={handleEditorChange}
      onquickopen={() => (switcherOpen = true)}
      {theme}
    />
  </div>
{/snippet}

{#snippet results()}
  <div class="results">
    {#if activeResult}
      <Result result={activeResult} bind:selection />
    {:else}
      <div class="no-query">
        <span>Run a statement to see results here</span>
      </div>
    {/if}
  </div>
{/snippet}

<!-- Monaco owns this chord while the editor has focus and handles it there;
     this catches it everywhere else, and keeps the browser's print dialog out
     of it either way. Opening an open switcher is a no-op. -->
<svelte:window
  onkeydown={(e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      switcherOpen = true;
    }
  }}
/>

<main>
  <div class="workspace">
    <SplitPane
      type="horizontal"
      min="10%"
      max="90%"
      pos="25%"
      --color="var(--border-dark)"
      --border-width="2px"
      --thickness="20px"
      a={browser}
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
            <div class="document">
              <DocumentHeader
                {workspace}
                {connections}
                onquickopen={() => (switcherOpen = true)}
              />
              <div class="document-body">
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
              </div>
            </div>
          {/snippet}
        </SplitPane>
      {/snippet}
    </SplitPane>
  </div>

  {#if switcherOpen}
    <FileSwitcher {workspace} {connections} onclose={() => (switcherOpen = false)} />
  {/if}
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    background-color: var(--bg-0);
  }

  pre {
    white-space: pre-line;
    /* font-family: '';*/
  }

  .browser {
    background-color: var(--bg-1);
  }

  .document {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .document-body {
    flex: 1;
    min-height: 0;
  }

  .workspace {
    min-height: 0;
    overflow: hidden;
    flex: 1;
  }

  .results {
    display: flex;
  }

  .no-query {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    height: 100%;
  }
</style>
