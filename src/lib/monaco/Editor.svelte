<script lang="ts">
  import { onMount, untrack } from "svelte";
  import * as monaco from "monaco-editor";
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

  const lensEmitter = new monaco.Emitter<monaco.languages.CodeLensProvider>();
  let codelensProvider: monaco.languages.CodeLensProvider | undefined;

  /**
   * Monaco renders code lens titles through TWO chained adaptive debounces
   * (provide >=250ms, then resolve >=250ms — see CodeLensController) and has
   * no public flush; result-state changes would lag half a second or more
   * behind execution. Both schedulers are reachable through the controller
   * (`_localToDispose._toDispose` for provide, `_resolveCodeLensesScheduler`
   * for resolve); scheduling them with delay 0 makes the update run in the
   * next macrotask. The resolve pass must run *after* the provide pass has
   * swapped its data, so it is flushed again shortly afterwards. Guarded so
   * a monaco upgrade simply falls back to the normal debounce.
   */
  function flushCodeLenses(): void {
    const controller = editor?.getContribution("css.editor.codeLens") as
      | {
          _localToDispose?: { _toDispose?: Set<unknown> };
          _resolveCodeLensesScheduler?: { schedule?: (delay?: number) => void };
        }
      | undefined;
    if (!controller) return;
    const store = controller._localToDispose?._toDispose;
    if (store) {
      for (const disposable of store) {
        const scheduler = disposable as { schedule?: (delay?: number) => void };
        if (typeof scheduler.schedule === "function") {
          scheduler.schedule(0);
        }
      }
    }
    const resolve = controller._resolveCodeLensesScheduler;
    if (resolve && typeof resolve.schedule === "function") {
      resolve.schedule(0);
      window.setTimeout(() => resolve.schedule?.(0), 80);
      window.setTimeout(() => resolve.schedule?.(0), 400);
    }
  }

  function fireLensUpdate(): void {
    if (codelensProvider) lensEmitter.fire(codelensProvider);
    flushCodeLenses();
  }

  // Re-render code lenses when a result changes state (running -> done/error).
  $effect(() => {
    const results = file?.results ?? [];
    for (const result of results) {
      void result.queryState;
      void result.rowCount;
      void result.error;
      void result.cancelling;
    }
    fireLensUpdate();
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

  function statementCodeStart(model: monaco.editor.ITextModel, statement: Statement): number {
    return statement.startOffset + codeStartIndex(statement.text);
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
   * that maps between editor positions and results needs answered.
   *
   * `liveOnly` skips results whose tracked range has collapsed: the statement
   * they belonged to was erased, so they must not be claimed by whatever gets
   * written at that position next. Only `runRange` passes false, so that a
   * lens click arriving a render behind the model still replaces the result
   * its statement owns rather than opening a second one beside it.
   */
  function resultAtRange(
    model: monaco.editor.ITextModel,
    range: monaco.IRange,
    liveOnly = true
  ): Result | undefined {
    const owner = fileOfModel.get(model);
    if (!owner) return undefined;
    for (const result of owner.results) {
      if (!result.anchorId) continue;
      const entry = anchors.get(result.anchorId);
      if (!entry || entry.model !== model) continue;
      const ranges = entry.collection.getRanges();
      if (liveOnly && isCollapsed(ranges)) continue;
      if (ranges.some((r) => rangesOverlap(r, range))) return result;
    }
    return undefined;
  }

  function resultForStatement(
    model: monaco.editor.ITextModel,
    statement: Statement
  ): Result | undefined {
    return resultAtRange(model, statementRange(model, statement));
  }

  /**
   * Gives detached results (statement erased) a fresh anchor when a statement
   * with the exact same text appears again — e.g. the statement was cut and
   * pasted elsewhere in the file. Returns true if anything was reattached.
   */
  function reattachDetached(model: monaco.editor.ITextModel, owner: SqlFile): boolean {
    const detached = owner.results.filter((r) => !r.anchorId);
    if (detached.length === 0 || !editor) return false;
    let reattached = false;
    for (const statement of statementsOf(model)) {
      if (detached.length === 0) break;
      // If this statement already has an active, non-collapsed anchor, skip it.
      const range = statementRange(model, statement);
      if (resultAtRange(model, range)) continue;

      const sql = statement.text.trim();
      const match = detached.find((r) => r.sql === sql);
      if (!match) continue;
      const anchorId = crypto.randomUUID();
      anchors.set(anchorId, {
        collection: editor.createDecorationsCollection([
          { range, options: {} }
        ]),
        model
      });
      match.anchorId = anchorId;
      detached.splice(detached.indexOf(match), 1);
      reattached = true;
    }
    return reattached;
  }

  // Marker codicon: it renders as an empty, hidden span and exists only so the
  // style block can select the lenses that should be red. Monaco escapes lens
  // titles and gives lenses no class of their own, so this is the only handle
  // CSS gets. The Trino error name lives in the lens tooltip instead.
  const FAILED = "$(trinette-failed)";

  function resultTitle(result: Result): string {
    if (result.canceled) return `${FAILED}☰ Results · canceled`;
    if (result.error) return `${FAILED}☰ Results · error`;
    if (result.cancelling) return "⏳ Cancelling…";
    if (result.running) return "⏳ Running…";
    return `☰ Results · ${result.rowCount ?? 0} rows · ${result.elapsedTimeSeconds}s`;
  }

  function resultTooltip(result: Result): string | undefined {
    if (!result.error) return undefined;
    const { errorName, message } = result.error;
    return errorName ? `${errorName}: ${message}` : message;
  }

  function runRange(model: monaco.editor.ITextModel, range: monaco.IRange, sql: string, startLine: number) {
    if (!onexecutesql || !editor) return;
    const owner = fileOfModel.get(model);
    if (!owner) return;
    // Re-running a statement replaces its previous result.
    const replacesId = resultAtRange(model, range, false)?.id;
    const anchorId = crypto.randomUUID();
    anchors.set(anchorId, {
      collection: editor.createDecorationsCollection([{ range, options: {} }]),
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
      codeLens: true,
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
        // Erasing a statement collapses its tracked range — detach the result
        // so it can neither be shown nor attach to replacement statements.
        const dead = owner.results.filter((result) => {
          const entry = anchors.get(result.anchorId);
          return entry?.model === model && isCollapsed(entry.collection.getRanges());
        });
        let changed = dead.length > 0;
        if (changed) {
          for (const result of dead) {
            anchors.get(result.anchorId)?.collection.clear();
            anchors.delete(result.anchorId);
          }
          owner.detachResults(dead);
        }
        // A pasted-back statement has the same text it was erased with —
        // reattach its result. Exact text match, same rule the lens uses.
        if (reattachDetached(model, owner)) changed = true;
        if (changed) fireLensUpdate();
      }
      onchange?.(model.getValue());
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

    monaco.editor.registerCommand("trino.runStatement", (_accessor, sql: string, codeStart: number, startLine: number) => {
      const model = editor?.getModel();
      if (!model) return;
      const statements = statementsOf(model);
      // Prefer the statement now living at the lens' code start; fall back to
      // exact text (the lens may be a render behind the model).
      const statement =
        statements.find((s) => statementCodeStart(model, s) === codeStart) ??
        statements.find((s) => s.text.trim() === sql);
      const range = statement ? statementRange(model, statement) : new monaco.Range(startLine, 1, startLine, 1);
      runRange(model, range, statement ? statement.text.trim() : sql, range.startLineNumber);
    });

    monaco.editor.registerCommand("trino.showResult", (_accessor, resultId: string) => {
      const result = file?.results.find((r) => r.id === resultId);
      if (result) onshowresult?.(result);
    });

    monaco.editor.registerCommand("trino.cancelResult", (_accessor, resultId: string) => {
      const result = file?.results.find((r) => r.id === resultId);
      if (result) oncancelresult?.(result);
    });

    const provider: monaco.languages.CodeLensProvider = {
      onDidChange: lensEmitter.event,
      provideCodeLenses(model) {
        const owner = fileOfModel.get(model);
        if (!owner) return { lenses: [] };
        const lenses: monaco.languages.CodeLens[] = [];
        for (const statement of statementsOf(model)) {
          const range = statementRange(model, statement);
          const line = range.startLineNumber;
          lenses.push({
            range: new monaco.Range(line, 1, line, 1),
            command: {
              id: "trino.runStatement",
              title: "▶ Run",
              arguments: [statement.text.trim(), statementCodeStart(model, statement), line]
            }
          });
          const result = resultForStatement(model, statement);
          if (result) {
            lenses.push({
              range: new monaco.Range(line, 1, line, 1),
              command: {
                id: "trino.showResult",
                title: resultTitle(result),
                tooltip: resultTooltip(result),
                arguments: [result.id]
              }
            });
            // Only offered while the cancel can still do something — once
            // asked for, the lens above reads "Cancelling…" instead.
            if (result.running && !result.cancelling) {
              lenses.push({
                range: new monaco.Range(line, 1, line, 1),
                command: {
                  id: "trino.cancelResult",
                  title: "✕ Cancel",
                  tooltip: "Cancel this query",
                  arguments: [result.id]
                }
              });
            }
          }
        }
        return { lenses };
      }
    };
    codelensProvider = provider;
    const providerDisposable = monaco.languages.registerCodeLensProvider("trino-sql", provider);

    editorReady = true;

    return () => {
      contentListener.dispose();
      providerDisposable.dispose();
      codelensProvider = undefined;
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

  /* Failed and cancelled result lenses, keyed off the marker codicon their
     title carries (see `FAILED` above). Monaco's `:hover` rule still wins over
     this, because that one is !important. */
  :global(.monaco-editor .codelens-decoration > a:has(.codicon-trinette-failed)) {
    color: var(--error);
  }

  /* The marker is a selector hook, not something to look at. Monaco only draws
     a codicon that some registry gave a glyph to, so this is belt and braces. */
  :global(.monaco-editor .codelens-decoration .codicon-trinette-failed) {
    display: none;
  }
</style>
