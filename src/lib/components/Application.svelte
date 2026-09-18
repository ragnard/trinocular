<script lang="ts">
  import type { Result as ResultModel, Workspace } from "$lib/State.svelte";
  import Editor from "$lib/monaco/Editor.svelte";
  import * as monaco from "monaco-editor";
  import { DelegatingMetadataProvider } from "$lib/catalog/DelegatingMetadataProvider";
  import { NOTHING_TO_DESCRIBE, TrinoMetadataProvider } from "$lib/catalog/TrinoMetadataProvider";
  import { theme } from "$lib/theme.svelte";
  import { untrack } from "svelte";

  import { SplitPane } from "./split-pane";
  import TopBar from "./TopBar.svelte";
  import Result from "./Result.svelte";
  import DataViewer from "./DataViewer.svelte";
  import Dialog from "./Dialog.svelte";
  import type { Selection } from "./table/types";
  import DocumentHeader from "./DocumentHeader.svelte";
  import FileSwitcher from "./FileSwitcher.svelte";
  import SchemaBrowser from "./SchemaBrowser.svelte";
  import { page } from "$app/state";

  let { workspace }: { workspace: Workspace } = $props();

  let selection: Selection | null = $state(null);
  let switcherOpen = $state(false);
  let recordOpen = $state(false);
  let editorRef: ReturnType<typeof Editor> | undefined = $state();
  let resultRef: ReturnType<typeof Result> | undefined = $state();
  let recordDialog: ReturnType<typeof Dialog> | undefined = $state();

  // Other tabs, and with the server store other browsers, share this
  // workspace; the store is how this tab hears about documents they add,
  // rename or delete. The effect's return value unsubscribes.
  $effect(() => workspace.watchStore());

  // A save waits half a second after the last keystroke; a tab closed inside
  // that window would lose it. `pagehide` is the last moment to send it.
  $effect(() => {
    const flush = () => {
      clearTimeout(saveTimer);
      workspace.flush();
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  });

  let connectionId = $derived(workspace.connectionId);
  let userId = $derived(page.data.userId);
  let logoutPath = $derived(page.data.logoutPath);
  let branding = $derived(page.data.branding);

  // What is chosen lives in `theme`; what is drawn is this. The OS preference
  // is only followed while the effect is mounted, and painting `<html>` is the
  // one thing that has to happen wherever the choice came from.
  let palette = $derived(theme.resolved);

  $effect(() => theme.watch());

  $effect(() => {
    document.documentElement.dataset.theme = palette;
  });

  // One delegate per connection, swapped when the active document points
  // somewhere else, so completions describe the cluster it actually runs on.
  // Seeded once, untracked; the effect below is what follows the document.
  const metadataProvider = new DelegatingMetadataProvider(
    new TrinoMetadataProvider(untrack(() => workspace.catalog))
  );

  $effect(() => {
    metadataProvider.delegate = workspace.hasConnections
      ? new TrinoMetadataProvider(workspace.catalogFor(connectionId))
      : NOTHING_TO_DESCRIBE;
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

  // Full-window is one whole row at a time, whatever cells were selected.
  function openRecord() {
    resultRef?.selectRow();
    recordOpen = true;
  }

  let saveTimer: ReturnType<typeof setTimeout>;
  function handleEditorChange() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => workspace.persist(), 500);
  }
</script>

{#snippet browser()}
  <SchemaBrowser {workspace} oninsert={(sql) => editorRef?.insert(sql)} />
{/snippet}

{#snippet viewer(expanded: boolean)}
  <!--
    The inspector is a pane of the window, not a region of the results: it
    reads whatever is selected, at full height, so a block selection is a stack
    of whole documents rather than a peephole.

    It is always on screen. It used to be closable, with a remembered position
    standing in for closed. The divider still moves; what it cannot do any more
    is reach the edge, because a pane you can drag shut with no button left to
    reopen it is a trap rather than a layout.

    The same component, with the same selection, is what the full-window
    dialog shows: the table stays mounted behind the dialog and still owns the
    selection, so stepping there is stepping here.

    How a field is drawn is a property of the document, so it travels with the
    file rather than with the result being inspected.
  -->
  <DataViewer
    {selection}
    rowCount={activeResult?.data?.length}
    formats={workspace.activeFile?.viewFormats ?? {}}
    onpick={(path, formatId) => {
      const file = workspace.activeFile;
      if (file) workspace.setViewFormat(file, path, formatId);
    }}
    onstep={(delta, extend) => resultRef?.step(delta, extend)}
    {expanded}
    onexpand={expanded ? undefined : openRecord}
    onclose={expanded ? () => recordDialog?.close() : undefined}
  />
{/snippet}

{#snippet inspector()}
  {@render viewer(false)}
{/snippet}

{#snippet editor()}
  <Editor
    bind:this={editorRef}
    file={workspace.activeFile}
    files={workspace.files}
    {metadataProvider}
    markers={editorMarkers}
    onexecutesql={(sql, startLine, anchorId, replacesId) =>
      workspace.run(sql, startLine, anchorId, replacesId)}
    onshowresult={(result) => workspace.showResult(result)}
    oncancelresult={(result) => void result.cancel()}
    onchange={handleEditorChange}
    onquickopen={() => (switcherOpen = true)}
    theme={palette}
  />
{/snippet}

{#snippet results()}
  <Result
    bind:this={resultRef}
    result={activeResult}
    bind:selection
    bind:rowLimit={workspace.rowLimit}
    bind:limitRows={workspace.limitRows}
    onopen={openRecord}
  />
{/snippet}

{#snippet doc()}
  <div class="document">
    <DocumentHeader {workspace} onquickopen={() => (switcherOpen = true)} />
    <div class="document-body">
      <SplitPane
        type="vertical"
        panes={[editor, results]}
        layout={[
          { size: 38, min: "10%" },
          { size: 62, min: "10%" }
        ]}
      />
    </div>
  </div>
{/snippet}

<!-- Monaco owns this chord while the editor has focus and handles it there;
     this catches it everywhere else, and keeps the browser's print dialog out
     of Cmd+P either way. -->
<svelte:window
  onkeydown={(e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (e.key.toLowerCase() !== "p") return;
    e.preventDefault();
    switcherOpen = true;
  }}
/>

<main>
  <TopBar {branding} {userId} {logoutPath} />
  <div class="workspace">
    <SplitPane
      type="horizontal"
      panes={[browser, doc, inspector]}
      layout={[
        { size: 19, min: "180px", max: "40%" },
        { size: 54, min: "30%" },
        { size: 27, min: "12%" }
      ]}
    />
  </div>

  {#if switcherOpen}
    <FileSwitcher {workspace} onclose={() => (switcherOpen = false)} />
  {/if}

  {#if recordOpen}
    <Dialog bind:this={recordDialog} onclose={() => (recordOpen = false)}>
      {@render viewer(true)}
    </Dialog>
  {/if}
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    width: 100vw;
    height: 100vh;
    background: var(--s0);
  }

  .workspace {
    flex: 1;
    min-height: 0;
    overflow: hidden;
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
</style>
