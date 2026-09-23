<script lang="ts">
  import type { Result as ResultModel, Workspace } from "$lib/State.svelte";
  import Editor from "$lib/monaco/Editor.svelte";
  import * as monaco from "monaco-editor";
  import { DelegatingMetadataProvider } from "$lib/catalog/DelegatingMetadataProvider";
  import { NOTHING_TO_DESCRIBE, TrinoMetadataProvider } from "$lib/catalog/TrinoMetadataProvider";
  import { theme } from "$lib/theme.svelte";
  import { readPref, writePref } from "$lib/prefs";
  import { untrack } from "svelte";

  import { SplitPane, sizesOf, withSizes, type PaneLayout } from "./split-pane";
  import TopBar from "./TopBar.svelte";
  import Result from "./Result.svelte";
  import DataViewer from "./DataViewer.svelte";
  import Dialog from "./Dialog.svelte";
  import type { Selection } from "./table/types";
  import DocumentHeader from "./DocumentHeader.svelte";
  import FileSwitcher from "./FileSwitcher.svelte";
  import SchemaBrowser from "./SchemaBrowser.svelte";
  import Shortcuts from "./Shortcuts.svelte";
  import { isTyping, type Pane } from "$lib/shortcuts";
  import { page } from "$app/state";
  import { TriangleAlert } from "@lucide/svelte";

  interface Props {
    workspace: Workspace;
    /** Why a `?sql=` link opened nothing, when one did not. */
    linkRefusal?: string | null;
  }

  let { workspace, linkRefusal = null }: Props = $props();

  // Dismissed here rather than by clearing the prop: the refusal is a fact
  // about how this page was opened, and the page does not get opened twice.
  let refusalDismissed = $state(false);

  let selection: Selection | null = $state(null);
  let switcherOpen = $state(false);
  let recordOpen = $state(false);
  let shortcutsOpen = $state(false);
  let shortcutsPane: Pane | undefined = $state();
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

  // Closing a tab with a query in flight throws the query away; ask first.
  // The listener is only there while something runs, since any `beforeunload`
  // listener keeps Firefox from putting the page in the back/forward cache.
  // Browsers show their own wording and ignore ours.
  $effect(() => {
    if (workspace.running === 0) return;
    const confirm = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", confirm);
    return () => window.removeEventListener("beforeunload", confirm);
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

  // The pane layout is a browser preference like the theme (`prefs.ts`):
  // dragging the inspector wide to read JSON is done once, not on every
  // visit. The bounds are declared here and never stored — only the sizes
  // are, and a stored size outside the bounds is dropped (`withSizes`). The
  // defaults are written as the absence of a key, so a browser nobody has
  // dragged in follows a change to them.
  const WORKSPACE_LAYOUT: PaneLayout[] = [
    { size: 19, min: "180px", max: "40%" },
    { size: 54, min: "30%" },
    { size: 27, min: "12%" }
  ];
  const DOCUMENT_LAYOUT: PaneLayout[] = [
    { size: 38, min: "10%" },
    { size: 62, min: "10%" }
  ];
  const LAYOUT_PREF = "layout";
  const storedLayout = readPref(LAYOUT_PREF, (v) =>
    typeof v === "object" && v !== null
      ? (v as { workspace?: unknown; document?: unknown })
      : undefined
  );
  let workspaceLayout = $state(withSizes(WORKSPACE_LAYOUT, storedLayout?.workspace));
  let documentLayout = $state(withSizes(DOCUMENT_LAYOUT, storedLayout?.document));

  $effect(() => {
    const value = { workspace: sizesOf(workspaceLayout), document: sizesOf(documentLayout) };
    const unchanged =
      same(value.workspace, sizesOf(WORKSPACE_LAYOUT)) &&
      same(value.document, sizesOf(DOCUMENT_LAYOUT));
    writePref(LAYOUT_PREF, unchanged ? undefined : value);
  });

  const same = (a: number[], b: number[]) => a.length === b.length && a.every((n, i) => n === b[i]);

  // One delegate per connection, swapped when the workspace is pointed
  // somewhere else, so completions describe the cluster it actually runs on.
  // Seeded once, untracked; the effect below is what follows the connection.
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
        message: result.errorMessage ?? result.error.message,
        severity: monaco.MarkerSeverity.Error
      }
    ];
  });

  // Full-window is one whole row at a time, whatever cells were selected.
  function openRecord() {
    resultRef?.selectRow();
    recordOpen = true;
  }

  // The card tints the section for the pane that had focus, which is read
  // off the `data-pane` wrapper around whatever holds it — the account menu
  // opens it from no pane at all, and nothing is tinted.
  function openShortcuts() {
    if (shortcutsOpen) return;
    const pane = document.activeElement?.closest<HTMLElement>("[data-pane]")?.dataset.pane;
    shortcutsPane = pane as Pane | undefined;
    shortcutsOpen = true;
  }

  let saveTimer: ReturnType<typeof setTimeout>;
  function handleEditorChange() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => workspace.persist(), 500);
  }
</script>

{#snippet browser()}
  <div class="surface" data-pane="browser">
    <SchemaBrowser {workspace} oninsert={(sql) => editorRef?.insert(sql)} />
  </div>
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
  <div class="surface" data-pane="inspector">
    <DataViewer
      {selection}
      rowCount={activeResult?.data?.length}
      formats={workspace.activeFile?.viewFormats ?? {}}
      onpick={(path, formatId) => {
        const file = workspace.activeFile;
        if (file) workspace.setViewFormat(file, path, formatId);
      }}
      onstep={(delta, extend, reveal) => resultRef?.step(delta, extend, reveal)}
      {expanded}
      onexpand={expanded ? undefined : openRecord}
      onclose={expanded ? () => recordDialog?.close() : undefined}
    />
  </div>
{/snippet}

{#snippet inspector()}
  {@render viewer(false)}
{/snippet}

{#snippet editor()}
  <div class="surface" data-pane="editor">
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
      onshortcuts={openShortcuts}
      theme={palette}
    />
  </div>
{/snippet}

{#snippet results()}
  <div class="surface" data-pane="results">
    <Result
      bind:this={resultRef}
      result={activeResult}
      bind:selection
      bind:rowLimit={workspace.rowLimit}
      bind:limitRows={workspace.limitRows}
      ceiling={workspace.ceiling}
      onopen={openRecord}
    />
  </div>
{/snippet}

{#snippet doc()}
  <div class="document">
    <DocumentHeader {workspace} onquickopen={() => (switcherOpen = true)} />
    <!-- A `?sql=` link that opened nothing says so: the alternative is an
         empty editor that reads as a link that worked. -->
    {#if linkRefusal && !refusalDismissed}
      <div class="notice">
        <TriangleAlert size={14} />
        <span class="fill">{linkRefusal}</span>
        <button class="chip" onclick={() => (refusalDismissed = true)}>Dismiss</button>
      </div>
    {/if}
    <div class="document-body">
      <SplitPane type="vertical" panes={[editor, results]} bind:layout={documentLayout} />
    </div>
  </div>
{/snippet}

<!-- Monaco owns Cmd+P while the editor has focus and handles it there; this
     catches it everywhere else, and keeps the browser's print dialog out of
     it either way. `?` is a character wherever text is typed — monaco's
     textarea, a filter box — and opens the shortcuts card everywhere else;
     the editor has its own chord for it. -->
<svelte:window
  onkeydown={(e) => {
    if (e.altKey) return;
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      switcherOpen = true;
    } else if (!(e.metaKey || e.ctrlKey) && e.key === "?" && !isTyping(e.target)) {
      e.preventDefault();
      openShortcuts();
    }
  }}
/>

<main>
  <TopBar {branding} {userId} {logoutPath} onshortcuts={openShortcuts} />
  <div class="workspace">
    <SplitPane type="horizontal" panes={[browser, doc, inspector]} bind:layout={workspaceLayout} />
  </div>

  {#if switcherOpen}
    <FileSwitcher {workspace} onclose={() => (switcherOpen = false)} />
  {/if}

  {#if recordOpen}
    <!-- The dialog hands focus back to whatever opened it, which for the
         chip is the chip; the row you stepped to is where it belongs. -->
    <Dialog
      bind:this={recordDialog}
      onclose={() => {
        recordOpen = false;
        resultRef?.focus();
      }}
    >
      {@render viewer(true)}
    </Dialog>
  {/if}

  {#if shortcutsOpen}
    <Dialog fit onclose={() => (shortcutsOpen = false)}>
      <Shortcuts current={shortcutsPane} onclose={() => (shortcutsOpen = false)} />
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

  /* Names the pane a key press landed in, for the shortcuts card; a split
     pane sizes its direct child, so the wrapper passes that on — to the
     children that are in the flow. A component that owns a menu renders the
     popover beside its own root, so it is a direct child too, and a popover
     is laid out in the top layer against the viewport: 100% of this is 100%
     of the window, which is how the inspector's format picker and the schema
     browser's statement menu came to cover the screen. `Menu` does size itself
     to its contents, but that rule is a scoped class like this one and loses
     the tie to whichever is written later — so the exclusion belongs with the
     container doing the stretching, not with the thing being stretched. */
  .surface,
  .surface > :global(*:not([popover])) {
    width: 100%;
    height: 100%;
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

  /* The same line the results pane draws its notices as, in the document. */
  .notice {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    min-height: var(--h-rail);
    padding: 6px 12px;
    background: var(--s1);
    border-bottom: 1px solid var(--line);
    color: var(--fg-2);
  }

  .notice :global(svg) {
    flex: none;
    color: var(--fg-3);
  }

  .notice .chip {
    flex: none;
  }
</style>
