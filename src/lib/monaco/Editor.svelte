<script lang="ts">
  import { mount, onMount, unmount, untrack, type Component } from "svelte";
  import * as monaco from "monaco-editor";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Play from "@lucide/svelte/icons/play";
  import Table from "@lucide/svelte/icons/table";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import X from "@lucide/svelte/icons/x";
  import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
  import {
    register,
    type DocumentParseService,
    type MetadataProvider,
    type StatementSlice
  } from "monaco-language-trino";
  import type { Result, SqlFile } from "$lib/State.svelte";

  type Statement = StatementSlice;

  /**
   * Statement boundaries come from the language registration's parse service
   * rather than a bare `splitStatements` call: the service memoises on the
   * model version, so the lens provider, the run commands and the change
   * listener all share one lex per edit instead of re-lexing the whole
   * document each time (the lens provider alone runs on every render).
   */
  let parseService: DocumentParseService | undefined;

  function statementsOf(model: monaco.editor.ITextModel): Statement[] {
    return parseService?.getStatements(model) ?? [];
  }

  interface Props {
    file?: SqlFile | null;
    files?: SqlFile[];
    options?: monaco.editor.IStandaloneEditorConstructionOptions;
    metadataProvider?: MetadataProvider;
    markers?: monaco.editor.IMarkerData[];
    onexecutesql?: (sql: string, startLine: number, anchorId: string, replacesResultId?: string) => void;
    onshowresult?: (result: Result) => void;
    oncancelresult?: (result: Result) => void;
    onchange?: (content: string) => void;
    /** Cmd/Ctrl+P, forwarded from inside the editor where it is swallowed. */
    onquickopen?: () => void;
    theme?: "light" | "dark";
  }

  let {
    file = null,
    files = [],
    options = {},
    metadataProvider,
    markers = [],
    onexecutesql,
    onshowresult,
    oncancelresult,
    onchange,
    onquickopen,
    theme = "light"
  }: Props = $props();

  let container: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  let editorReady = $state(false);
  let editorModel: monaco.editor.ITextModel | undefined = $state();

  const models = new WeakMap<SqlFile, monaco.editor.ITextModel>();
  const fileOfModel = new WeakMap<monaco.editor.ITextModel, SqlFile>();
  // anchorId -> decoration collection tracking a result's statement range
  // through edits; decorations are monaco's native edit-tracking, so a result
  // stays attached to "its" statement even after the statement text changes.
  const anchors = new Map<
    string,
    { collection: monaco.editor.IEditorDecorationsCollection; model: monaco.editor.ITextModel }
  >();

  /**
   * An anchor must not swallow what is typed beside it. Monaco's default
   * stickiness extends a decoration over text inserted at either of its edges,
   * so pressing Enter at the end of a statement and writing the next one grew
   * the first statement's anchor across both — and the new, never-run
   * statement came up already wearing its neighbour's result, "Run" and
   * "Results" side by side. Edits *inside* the statement still move and
   * stretch the anchor, which is what keeps a result attached to its
   * statement while it is being rewritten.
   */
  const ANCHOR_DECORATION: monaco.editor.IModelDecorationOptions = {
    stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
  };

  // Redraw the statement toolbars when a result changes state (running ->
  // finished / failed / cancelling). Reading the fields is what subscribes
  // this effect to them; the redraw itself is a textContent write.
  $effect(() => {
    void editorModel; // re-sync after a file switch swaps the model
    for (const result of file?.results ?? []) {
      void result.queryState;
      void result.rowCount;
      void result.error;
      void result.cancelling;
      void result.canceled;
      void result.elapsedTimeSeconds;
      void result.infoUri;
    }
    syncToolbars();
  });

  $effect(() => {
    if (editorModel) {
      monaco.editor.setModelMarkers(editorModel, "external", markers);
    }
  });

  $effect(() => {
    monaco.editor.setTheme(theme === "dark" ? "trino-dark" : "trino-light");
  });

  // Swap in the model for the active file; models are cached per file so undo
  // history and result anchors survive file switches.
  $effect(() => {
    if (!editorReady) return;
    const activeFile = file;
    if (!activeFile || !editor) return;
    let model = models.get(activeFile);
    if (!model) {
      model = monaco.editor.createModel(untrack(() => activeFile.content), "trino-sql");
      models.set(activeFile, model);
      fileOfModel.set(model, activeFile);
    }
    if (editor.getModel() !== model) editor.setModel(model);
    editorModel = model;
  });

  // Drop anchors for evicted results; dispose models of deleted files (monaco
  // keeps created models in a global registry, so they leak without this).
  $effect(() => {
    const activeFile = file;
    const liveAnchors = new Set((activeFile?.results ?? []).map((r) => r.anchorId));
    const deadModels = new Set<monaco.editor.ITextModel>();
    for (const [anchorId, entry] of anchors) {
      const owner = fileOfModel.get(entry.model);
      if (!owner) continue;
      const dead = owner === activeFile ? !liveAnchors.has(anchorId) : !files.includes(owner);
      if (dead) {
        entry.collection.clear();
        anchors.delete(anchorId);
        if (owner !== activeFile) deadModels.add(entry.model);
      }
    }
    for (const model of deadModels) {
      const owner = fileOfModel.get(model);
      fileOfModel.delete(model);
      if (owner) models.delete(owner);
      model.dispose();
    }
  });

  self.MonacoEnvironment = {
    getWorker: () => new editorWorker()
  };

  monaco.editor.defineTheme("trino-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "0000FF" },
      { token: "string", foreground: "A31515" },
      { token: "number", foreground: "098658" },
      { token: "comment", foreground: "008000" },
      { token: "operator", foreground: "000000" },
      { token: "type", foreground: "267f99" },
      { token: "identifier", foreground: "001080" },
      { token: "delimiter", foreground: "000000" }
    ],
    colors: {}
  });

  monaco.editor.defineTheme("trino-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "569CD6" },
      { token: "string", foreground: "CE9178" },
      { token: "number", foreground: "B5CEA8" },
      { token: "comment", foreground: "6A9955" },
      { token: "operator", foreground: "D4D4D4" },
      { token: "type", foreground: "4EC9B0" },
      { token: "identifier", foreground: "9CDCFE" },
      { token: "delimiter", foreground: "D4D4D4" }
    ],
    colors: {}
  });

  function rangesOverlap(a: monaco.IRange, b: monaco.IRange): boolean {
    // lexicographic (line, column) comparison; interval overlap: a.start <= b.end && b.start <= a.end
    const aStartBeforeBEnd = a.startLineNumber - b.endLineNumber || a.startColumn - b.endColumn;
    const bStartBeforeAEnd = b.startLineNumber - a.endLineNumber || b.startColumn - a.endColumn;
    return aStartBeforeBEnd <= 0 && bStartBeforeAEnd <= 0;
  }

  function isCollapsed(ranges: monaco.IRange[]): boolean {
    return (
      ranges.length === 0 ||
      ranges.every((r) => r.startLineNumber === r.endLineNumber && r.startColumn === r.endColumn)
    );
  }

  // Offset into the statement text where actual SQL code starts, skipping
  // leading whitespace and comment lines. splitStatements slices between
  // semicolons, so a statement's text can begin with the *previous*
  // statement's trailing comment — anchoring there would place the lens (and
  // result association) on the wrong line.
  function codeStartIndex(text: string): number {
    let i = 0;
    while (i < text.length) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text.startsWith("--", i)) {
        const nl = text.indexOf("\n", i);
        i = nl === -1 ? text.length : nl + 1;
        continue;
      }
      if (text.startsWith("/*", i)) {
        const end = text.indexOf("*/", i + 2);
        i = end === -1 ? text.length : end + 2;
        continue;
      }
      break;
    }
    return i;
  }

  function statementRange(model: monaco.editor.ITextModel, statement: Statement): monaco.IRange {
    const start = model.getPositionAt(statement.startOffset + codeStartIndex(statement.text));
    const end = model.getPositionAt(statement.endOffset);
    return {
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column
    };
  }

  function statementAtOffset(model: monaco.editor.ITextModel, offset: number): Statement | null {
    const statements = statementsOf(model);
    if (statements.length === 0) return null;
    const match = statements.find((s) => offset >= s.startOffset && offset <= s.endOffset);
    // Cursor is past all statements (trailing whitespace after last ";") — use last statement
    return match ?? statements[statements.length - 1];
  }

  /**
   * The result anchored over `range`, if any — the one question every caller
   * that maps between editor positions and results needs answered. A result
   * whose anchor collapsed is dropped by the change listener as the edit
   * lands, so every result still in the file has a live anchor by the time
   * anyone asks.
   */
  function resultAtRange(
    model: monaco.editor.ITextModel,
    range: monaco.IRange
  ): Result | undefined {
    const owner = fileOfModel.get(model);
    if (!owner) return undefined;
    for (const result of owner.results) {
      const entry = anchors.get(result.anchorId);
      if (!entry || entry.model !== model) continue;
      if (entry.collection.getRanges().some((r) => rangesOverlap(r, range))) return result;
    }
    return undefined;
  }

  function resultForStatement(
    model: monaco.editor.ITextModel,
    statement: Statement
  ): Result | undefined {
    return resultAtRange(model, statementRange(model, statement));
  }

  /** The icon and text the status button carries in a given result state. */
  function resultStatus(result: Result): { icon: IconComponent; text: string; spin: boolean } {
    if (result.canceled) return { icon: CircleAlert, text: "Canceled", spin: false };
    // A failed statement has no rows behind it, so the status says so rather
    // than offering "Results" behind a table icon.
    if (result.error) return { icon: TriangleAlert, text: "Error", spin: false };
    if (result.cancelling) return { icon: LoaderCircle, text: "Cancelling…", spin: true };
    if (result.running) return { icon: LoaderCircle, text: "Running…", spin: true };
    const rows = result.rowCount ?? 0;
    return {
      icon: Table,
      text: `Results · ${rows} ${rows === 1 ? "row" : "rows"} · ${result.elapsedTimeSeconds}s`,
      spin: false
    };
  }

  function resultTooltip(result: Result): string | undefined {
    if (!result.error) return undefined;
    const { errorName, message } = result.error;
    return errorName ? `${errorName}: ${message}` : message;
  }

  /* --- Statement toolbars -------------------------------------------------
   *
   * The "Run / status / Cancel" strip above each statement is drawn by
   * this component rather than by a CodeLensProvider: a view zone opens the
   * band and a content widget fills it, which is how monaco builds its own
   * code lenses (contrib/codelens/browser/codelensWidget). What it leaves out
   * is the two chained RunOnceSchedulers monaco puts in front of provide and
   * resolve — a query's state reached a lens a third of a second late, and
   * monaco exposes no way to flush them, so this used to be done by reaching
   * into the controller's private schedulers.
   *
   * Owning the DOM means a state change is a textContent write, and the failed
   * state can take a real CSS class instead of being smuggled through a marker
   * codicon in an escaped title string.
   */

  type IconComponent = Component<{ size?: number }>;

  /** Matches the 16px icons the sidebar uses. */
  const ICON_SIZE = 16;

  /**
   * Lucide ships svelte components, not raw path data, and the toolbar is
   * plain DOM — so each icon is its own little mounted component tree. The
   * slot remembers what is mounted so a state change that does not change the
   * icon (row count ticking up) does not remount it.
   */
  interface IconSlot {
    host: HTMLElement;
    current?: IconComponent;
    instance?: Record<string, unknown>;
  }

  function setIcon(slot: IconSlot, icon: IconComponent): void {
    if (slot.current === icon) return;
    if (slot.instance) unmount(slot.instance);
    slot.current = icon;
    slot.instance = mount(icon, { target: slot.host, props: { size: ICON_SIZE } });
  }

  function clearIcon(slot: IconSlot): void {
    if (slot.instance) unmount(slot.instance);
    slot.instance = undefined;
    slot.current = undefined;
  }

  interface ToolbarButton {
    el: HTMLAnchorElement;
    slot: IconSlot;
    label: HTMLElement;
  }

  interface StatementToolbar {
    node: HTMLElement;
    run: ToolbarButton;
    status: ToolbarButton;
    details: ToolbarButton;
    cancel: ToolbarButton;
    widget: monaco.editor.IContentWidget;
    /** The zone object monaco holds: mutate it, then ask for a re-layout. */
    zone: monaco.editor.IViewZone;
    zoneId: string;
    line: number;
    statement: Statement | null;
    result: Result | null;
  }

  let toolbars: StatementToolbar[] = [];
  let toolbarModel: monaco.editor.ITextModel | undefined;

  /** Band height and text size, mirroring monaco's own code lens sizing. */
  function toolbarMetrics(): { fontSize: number; height: number } {
    const opts = monaco.editor.EditorOption;
    const editorFontSize = editor?.getOption(opts.fontSize) ?? 14;
    const lineHeight = editor?.getOption(opts.lineHeight) ?? 19;
    const fontSize =
      editor?.getOption(opts.codeLensFontSize) || Math.floor(editorFontSize * 0.9);
    const factor = Math.max(1.3, lineHeight / editorFontSize);
    return { fontSize, height: Math.floor(fontSize * factor) };
  }

  function createToolbar(
    index: number,
    accessor: monaco.editor.IViewZoneChangeAccessor
  ): StatementToolbar {
    const node = document.createElement("div");
    node.className = "trinette-statement-toolbar";

    const button = (className: string, icon: IconComponent | null, text?: string) => {
      const el = document.createElement("a");
      el.className = `action ${className}`;
      el.setAttribute("role", "button");
      const slot: IconSlot = { host: document.createElement("span") };
      slot.host.className = "icon";
      const label = document.createElement("span");
      label.className = "label";
      if (text) label.textContent = text;
      el.append(slot.host, label);
      if (icon) setIcon(slot, icon);
      return { el, slot, label };
    };

    const run = button("run", Play, "Run");
    const status = button("status", null);
    // A real link rather than a role="button": it leaves for the cluster's own
    // query page, so middle-click and "copy link address" do what they look
    // like they do. Monaco suppresses only mousedown; a click still navigates.
    const details = button("details", ExternalLink, "Details");
    details.el.removeAttribute("role");
    details.el.target = "_blank";
    details.el.rel = "noopener noreferrer";
    details.el.title = "Open this query in the Trino UI";
    const cancel = button("cancel", X, "Cancel");
    cancel.el.title = "Cancel this query";
    node.append(run.el, status.el, details.el, cancel.el);

    const zone: monaco.editor.IViewZone = {
      afterLineNumber: 0,
      afterColumn: Number.MAX_SAFE_INTEGER,
      heightInPx: toolbarMetrics().height,
      domNode: document.createElement("div"),
      suppressMouseDown: true
    };

    const toolbar: StatementToolbar = {
      node,
      run,
      status,
      details,
      cancel,
      widget: null!,
      zone,
      zoneId: "",
      line: 1,
      statement: null,
      result: null
    };

    // The handlers read the toolbar's *current* statement and result, so a
    // strip that has been reused for a different statement still acts on the
    // right one.
    run.el.addEventListener("click", () => {
      const model = editor?.getModel();
      if (!model || !toolbar.statement) return;
      const range = statementRange(model, toolbar.statement);
      runRange(model, range, toolbar.statement.text.trim(), range.startLineNumber);
    });
    status.el.addEventListener("click", () => {
      if (toolbar.result) onshowresult?.(toolbar.result);
    });
    cancel.el.addEventListener("click", () => {
      if (toolbar.result) oncancelresult?.(toolbar.result);
    });

    toolbar.widget = {
      // Monaco keys its widget map by this id, so it has to be unique —
      // reusing one for another strip would silently replace the first.
      getId: () => `trinette.statement-toolbar.${index}`,
      getDomNode: () => node,
      // Keeps the caret put when a button is pressed. Only mousedown is
      // suppressed, so the click still lands on the button.
      suppressMouseDown: true,
      allowEditorOverflow: false,
      getPosition: () => {
        const model = editor?.getModel();
        if (!model || toolbar.line > model.getLineCount()) return null;
        return {
          position: {
            lineNumber: toolbar.line,
            column: model.getLineFirstNonWhitespaceColumn(toolbar.line) || 1
          },
          preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE]
        };
      }
    };

    toolbar.zoneId = accessor.addZone(zone);
    editor?.addContentWidget(toolbar.widget);
    return toolbar;
  }

  function removeAllToolbars(): void {
    if (toolbars.length === 0) return;
    const dead = toolbars;
    toolbars = [];
    editor?.changeViewZones((accessor) => {
      for (const toolbar of dead) {
        accessor.removeZone(toolbar.zoneId);
        editor?.removeContentWidget(toolbar.widget);
        // Each icon is a mounted component tree of its own.
        for (const button of [toolbar.run, toolbar.status, toolbar.details, toolbar.cancel]) {
          clearIcon(button.slot);
        }
      }
    });
  }

  function renderToolbar(toolbar: StatementToolbar, result: Result | undefined): void {
    toolbar.result = result ?? null;
    toolbar.status.el.hidden = !result;
    toolbar.details.el.hidden = true;
    toolbar.cancel.el.hidden = true;
    if (!result) return;

    const { icon, text, spin } = resultStatus(result);
    setIcon(toolbar.status.slot, icon);
    toolbar.status.slot.host.classList.toggle("spin", spin);
    toolbar.status.label.textContent = text;
    // A cancelled query is reported by Trino as a USER_CANCELED failure, so
    // both it and a genuine error land on the same styling.
    toolbar.status.el.classList.toggle("failed", Boolean(result.error));
    const tooltip = resultTooltip(result);
    if (tooltip) toolbar.status.el.title = tooltip;
    else toolbar.status.el.removeAttribute("title");
    // Trino reports `infoUri` — its own page for the query — alongside the
    // query id, on the first response and every one after, so the link stands
    // for as long as the cluster keeps the query, running or finished.
    if (result.queryId && result.infoUri) {
      toolbar.details.el.href = result.infoUri;
      toolbar.details.el.hidden = false;
    } else {
      toolbar.details.el.removeAttribute("href");
    }
    // Only offered while the cancel can still do something — once asked for,
    // the status beside it reads "Cancelling…" instead.
    toolbar.cancel.el.hidden = !(result.running && !result.cancelling);
  }

  /**
   * Brings the toolbars in line with the document: one per statement, in
   * document order, each showing its statement's result. Strips are reused,
   * so the common case (a result changing state) touches only text and
   * classes; only the ones falling off the end are torn down.
   */
  function syncToolbars(): void {
    if (!editor) return;
    const model = editor.getModel();
    if (!model) {
      removeAllToolbars();
      toolbarModel = undefined;
      return;
    }
    if (model !== toolbarModel) {
      removeAllToolbars();
      toolbarModel = model;
    }

    // One strip per *line*, not per statement. Monaco places a content widget
    // from its anchor alone and does no collision avoidance, so two statements
    // sharing a start line ("select 1; select 2;") would stack their strips
    // exactly on top of each other. The first statement on a line owns it,
    // which is what monaco's own lens controller does with duplicate lines —
    // and what this editor showed before, since that dedupe used to happen
    // inside monaco. Ctrl+Enter still runs whichever statement holds the caret.
    const slots: { statement: Statement; line: number }[] = [];
    for (const statement of statementsOf(model)) {
      const line = statementRange(model, statement).startLineNumber;
      if (slots.length > 0 && slots[slots.length - 1].line === line) continue;
      slots.push({ statement, line });
    }
    const { fontSize, height } = toolbarMetrics();

    editor.changeViewZones((accessor) => {
      while (toolbars.length > slots.length) {
        const toolbar = toolbars.pop()!;
        accessor.removeZone(toolbar.zoneId);
        editor?.removeContentWidget(toolbar.widget);
      }
      while (toolbars.length < slots.length) {
        toolbars.push(createToolbar(toolbars.length, accessor));
      }

      slots.forEach(({ statement, line }, i) => {
        const toolbar = toolbars[i];
        toolbar.statement = statement;
        toolbar.line = line;
        toolbar.node.style.fontSize = `${fontSize}px`;
        toolbar.node.style.lineHeight = `${height}px`;
        // Monaco reads the zone object it was handed, so mutate it in place.
        if (toolbar.zone.afterLineNumber !== line - 1 || toolbar.zone.heightInPx !== height) {
          toolbar.zone.afterLineNumber = line - 1;
          toolbar.zone.heightInPx = height;
          accessor.layoutZone(toolbar.zoneId);
        }
        renderToolbar(toolbar, resultForStatement(model, statement));
      });
    });

    // A content widget only refreshes the model position it caches when it is
    // laid out, so this is required after any edit, not just a line change.
    for (const toolbar of toolbars) editor.layoutContentWidget(toolbar.widget);
  }

  function runRange(model: monaco.editor.ITextModel, range: monaco.IRange, sql: string, startLine: number) {
    if (!onexecutesql || !editor) return;
    const owner = fileOfModel.get(model);
    if (!owner) return;
    // Re-running a statement replaces its previous result.
    const replacesId = resultAtRange(model, range)?.id;
    const anchorId = crypto.randomUUID();
    anchors.set(anchorId, {
      collection: editor.createDecorationsCollection([{ range, options: ANCHOR_DECORATION }]),
      model
    });
    onexecutesql(sql, startLine, anchorId, replacesId);
  }

  function runStatement(model: monaco.editor.ITextModel, editor: monaco.editor.IStandaloneCodeEditor) {
    const selection = editor.getSelection();
    if (selection && !selection.isEmpty()) {
      runRange(model, selection, model.getValueInRange(selection), selection.startLineNumber);
      return;
    }

    const position = editor.getPosition();
    if (!position) return;

    const statement = statementAtOffset(model, model.getOffsetAt(position));
    if (!statement) return;
    const range = statementRange(model, statement);
    runRange(model, range, statement.text.trim(), range.startLineNumber);
  }

  onMount(() => {
    const registration = register(monaco, { metadataProvider });
    parseService = registration.parseService;
    editor = monaco.editor.create(container, {
      language: "trino-sql",
      theme: theme === "dark" ? "trino-dark" : "trino-light",
      fontFamily: "Iosevka SS08",
      fontSize: 16,
      fontLigatures: true,
      minimap: { enabled: false },
      wordBasedSuggestions: "off",
      "semanticHighlighting.enabled": true,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      ...options
    });

    const contentListener = editor.onDidChangeModelContent(() => {
      const model = editor?.getModel();
      if (!model) return;
      const owner = fileOfModel.get(model);
      if (owner) {
        owner.content = model.getValue();
        // Erasing a statement collapses its tracked range, which is the end of
        // its result: dropping it also stops a query that is still running.
        const dead = owner.results.filter((result) => {
          const entry = anchors.get(result.anchorId);
          return entry?.model === model && isCollapsed(entry.collection.getRanges());
        });
        if (dead.length > 0) {
          for (const result of dead) {
            anchors.get(result.anchorId)?.collection.clear();
            anchors.delete(result.anchorId);
          }
          owner.dropResults(dead);
        }
      }
      // Every edit can move a statement, so the strips are always re-synced.
      syncToolbars();
      onchange?.(model.getValue());
    });

    editor.addAction({
      id: "trino.switchFile",
      label: "Switch File",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP],
      run: () => onquickopen?.()
    });

    editor.addAction({
      id: "trino.runCurrentStatement",
      label: "Run Current Statement",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => {
        const model = editor?.getModel();
        if (model && editor) runStatement(model, editor);
      }
    });

    // The band's height is derived from the font metrics, so a font or
    // line-height change has to redraw it.
    const configListener = editor.onDidChangeConfiguration(() => syncToolbars());

    editorReady = true;
    syncToolbars();

    return () => {
      contentListener.dispose();
      configListener.dispose();
      removeAllToolbars();
      toolbarModel = undefined;
      editor?.dispose();
      editorReady = false;
      editorModel = undefined;
      parseService = undefined;
      registration.dispose();
    };
  });
</script>

<div bind:this={container} class="editor-container"></div>

<style>
  .editor-container {
    width: 100%;
    height: 100%;
  }

  /* The statement toolbar is built in script and mounted by monaco outside
     this component's markup, so its rules have to be global. */
  /* Laid out with inline flow and sibling margins rather than flex: monaco
     sets `display` inline on a content widget's own node, which would beat a
     stylesheet rule short of !important. Its own code lens spaces its links
     the same way. */
  :global(.monaco-editor .trinette-statement-toolbar) {
    white-space: nowrap;
    color: var(--text-2);
  }

  /* `!important` because the `.action` rule below sets `display` at the same
     specificity and comes later, which would otherwise un-hide the button. */
  :global(.monaco-editor .trinette-statement-toolbar [hidden]) {
    display: none !important;
  }

  :global(.monaco-editor .trinette-statement-toolbar .action) {
    cursor: pointer;
    user-select: none;
    /* "Details" is a real `<a href>`, so it would otherwise arrive wearing the
       browser's own link colour and underline. */
    color: inherit;
    text-decoration: none;
    /* inline-flex, not inline: keeps the icon and its label on one baseline.
       Only the widget's own root has its display forced by monaco. */
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
  }

  /* Lucide renders `stroke="currentColor"`, so the icons inherit the hover and
     failed colours below without any extra rules. */
  :global(.monaco-editor .trinette-statement-toolbar .icon) {
    display: inline-flex;
    align-items: center;
  }

  /* Undoes the `max-width: 100%` the app's reset puts on every svg, which is
     what used to leave a strip reading "Run" with no icon beside it until
     something forced a re-layout. Monaco caps a content widget that may not
     overflow at the editor's content width, and it reads that width once, when
     the widget is added — for the strips built on the first pass, before the
     editor has been laid out, that is 0. The label survives a `max-width: 0`
     ancestor because nowrap text overflows it; the icon, a replaced element
     sizing itself against its container, collapsed to nothing. */
  :global(.monaco-editor .trinette-statement-toolbar .icon svg) {
    max-width: none;
    flex: none;
  }

  :global(.monaco-editor .trinette-statement-toolbar .icon.spin svg) {
    animation: trinette-spin 1s linear infinite;
  }

  @keyframes trinette-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.monaco-editor .trinette-statement-toolbar .icon.spin svg) {
      animation: none;
    }
  }

  :global(.monaco-editor .trinette-statement-toolbar .action + .action) {
    margin-left: 1em;
  }

  :global(.monaco-editor .trinette-statement-toolbar .action:hover) {
    color: var(--accent);
    text-decoration: underline;
  }

  /* Failed and cancelled results — Trino reports a cancel as a failure. */
  :global(.monaco-editor .trinette-statement-toolbar .status.failed) {
    color: var(--error);
  }
</style>
