<script lang="ts">
  import type { Result as ResultModel, Workspace } from "$lib/State.svelte";
  import type { Branding } from "$lib/server/config";
  import Editor from "$lib/monaco/Editor.svelte";
  import * as monaco from "monaco-editor";
  import { DelegatingMetadataProvider } from "$lib/catalog/DelegatingMetadataProvider";
  import { TrinoMetadataProvider } from "$lib/catalog/TrinoMetadataProvider";
  import { theme } from "$lib/theme.svelte";

  import { SplitPane } from "./split-pane";
  import TopBar from "./TopBar.svelte";
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

  // Other tabs share this workspace's storage; the `storage` event is how this
  // one hears about documents they add, rename or delete. The effect's return
  // value unsubscribes.
  $effect(() => workspace.watchOtherTabs());

  let connections: { id: string; name: string }[] = $derived(page.data.connections ?? []);
  let connectionId = $derived(workspace.connectionId);
  let userId = $derived(page.data.userId);
  let logoutPath = $derived(page.data.logoutPath);
  let branding: Branding = $derived(page.data.branding);

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
</script>

{#snippet browser()}
  <SchemaBrowser {workspace} />
{/snippet}

{#snippet inspector()}
  <!--
    The inspector is a pane of the window, not a region of the results: it
    reads whatever is selected, at full height, so a block selection is a stack
    of whole documents rather than a peephole.

    It is always on screen. It used to be closable, which meant a remembered
    position and "100%" — SplitPane's way of saying "no second pane, divider
    included" — standing in for closed. The divider still moves; what it cannot
    do any more is reach 100%, because a pane you can drag shut with no button
    left to reopen it is a trap rather than a layout.

    How a field is drawn is a property of the document, so it travels with the
    file rather than with the result being inspected.
  -->
  <DataViewer
    {selection}
    formats={workspace.activeFile?.viewFormats ?? {}}
    onpick={(path, formatId) => {
      const file = workspace.activeFile;
      if (file) workspace.setViewFormat(file, path, formatId);
    }}
  />
{/snippet}

{#snippet editor()}
  <Editor
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
  <Result result={activeResult} bind:selection />
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
    <SplitPane type="horizontal" min="180px" max="40%" pos="19%" a={browser}>
      {#snippet b()}
        <SplitPane type="horizontal" min="35%" max="85%" pos="66%" b={inspector}>
          {#snippet a()}
            <div class="document">
              <DocumentHeader {workspace} {connections} onquickopen={() => (switcherOpen = true)} />
              <div class="document-body">
                <SplitPane type="vertical" min="10%" max="90%" pos="38%" a={editor} b={results} />
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
