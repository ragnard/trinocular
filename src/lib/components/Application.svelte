<script lang="ts">
  import type { Result as ResultModel, Workspace } from "$lib/State.svelte";
  import Editor from "$lib/monaco/Editor.svelte";
  import * as monaco from "monaco-editor";
  import { onMount } from "svelte";
  import { Moon, Sun } from "@lucide/svelte";
  import { DelegatingMetadataProvider } from "$lib/catalog/DelegatingMetadataProvider";
  import { TrinoMetadataProvider } from "$lib/catalog/TrinoMetadataProvider";

  import { SplitPane } from "./split-pane";
  import type { Length } from "./split-pane/types";
  import Logo from "./Logo.svelte";
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

  /**
   * The inspector is a pane of the window, not a region of the results: it
   * reads whatever is selected, at full height, so a block selection is a
   * stack of whole documents rather than a peephole. Closed, it costs
   * nothing — the strip under the table already carries the anchor cell.
   *
   * "100%" is how SplitPane says "no second pane", divider included, so the
   * toggle is just a remembered position.
   */
  const INSPECTOR_DEFAULT: Length = "66%";
  let inspectorPos: Length = $state("100%");
  let lastInspectorPos: Length = INSPECTOR_DEFAULT;
  let inspectorOpen = $derived(inspectorPos !== "100%");

  function toggleInspector() {
    if (inspectorPos === "100%") {
      inspectorPos = lastInspectorPos;
    } else {
      lastInspectorPos = inspectorPos;
      inspectorPos = "100%";
    }
  }

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

  const decoder = new TextDecoder("utf-8", { fatal: true });

  function decodeBinary(bytes: Uint8Array): string {
    try {
      const text = decoder.decode(bytes);
      if (text.startsWith('{"')) {
        try {
          return JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          // Not JSON after all; the decoded text is still the better answer.
        }
      }
      return text;
    } catch {
      return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
  }
</script>

{#snippet browser()}
  <SchemaBrowser {workspace} />
{/snippet}

{#snippet inspector()}
  <DataViewer {selection} onclose={toggleInspector}>
    {#snippet formatValue(field, value)}
      {#if field.dataType === "binary"}
        <pre>{decodeBinary(value)}</pre>
      {:else if value === null || value === undefined}
        {"null"}
      {:else}
        {typeof value === "object" ? JSON.stringify(value) : value}
      {/if}
    {/snippet}
  </DataViewer>
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
    oncancelresult={(result) => workspace.cancel(result)}
    onchange={handleEditorChange}
    onquickopen={() => (switcherOpen = true)}
    ontoggleinspector={toggleInspector}
    {theme}
  />
{/snippet}

{#snippet results()}
  <Result
    result={activeResult}
    bind:selection
    {inspectorOpen}
    onToggleInspector={toggleInspector}
  />
{/snippet}

<!-- Monaco owns these chords while the editor has focus and handles them
     there; this catches them everywhere else, and keeps the browser's print
     dialog out of Cmd+P either way. -->
<svelte:window
  onkeydown={(e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    const key = e.key.toLowerCase();
    if (key === "p") {
      e.preventDefault();
      switcherOpen = true;
    } else if (key === "i") {
      e.preventDefault();
      toggleInspector();
    }
  }}
/>

<main>
  <div class="workspace">
    <SplitPane type="horizontal" min="180px" max="40%" pos="19%" a={browser}>
      {#snippet b()}
        <SplitPane type="horizontal" min="35%" max="100%" bind:pos={inspectorPos} b={inspector}>
          {#snippet a()}
            <div class="document">
              <DocumentHeader
                {workspace}
                {connections}
                onquickopen={() => (switcherOpen = true)}
              />
              <div class="document-body">
                <SplitPane type="vertical" min="10%" max="90%" pos="38%" a={editor} b={results} />
              </div>
            </div>
          {/snippet}
        </SplitPane>
      {/snippet}
    </SplitPane>
  </div>

  <!-- Brand and identity live here rather than bracketing the schema tree,
       which is what let that pane's header become one line. -->
  <footer>
    <Logo />
    <span>Oink</span>
    <span class="fill"></span>
    <span class="ell user">{userId}</span>
    <span class="rule"></span>
    <button class="chip square" onclick={toggleTheme} title="Toggle dark mode">
      {#if theme === "light"}<Moon size={12} />{:else}<Sun size={12} />{/if}
    </button>
  </footer>

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

  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    height: 26px;
    padding: 0 6px 0 12px;
    background: var(--s1);
    border-top: 1px solid var(--line-strong);
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  footer .fill {
    flex: 1;
  }

  .user {
    max-width: 24em;
  }

  .rule {
    width: 1px;
    height: 12px;
    background: var(--line-strong);
  }

  footer .chip {
    height: 20px;
    width: 20px;
  }

  pre {
    margin: 0;
    white-space: pre-wrap;
  }
</style>
