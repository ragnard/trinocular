<script lang="ts">
  import { onMount } from "svelte";
  import * as monaco from "monaco-editor";
  import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
  import { register, splitStatements, type MetadataProvider } from "monaco-language-trino";

  interface Props {
    value?: string;
    options?: monaco.editor.IStandaloneEditorConstructionOptions;
    metadataProvider?: MetadataProvider;
    markers?: monaco.editor.IMarkerData[];
    onexecutesql?: (sql: string, startLine: number) => void;
    theme?: 'light' | 'dark';
  }

  let { value = "", options = {}, metadataProvider, markers = [], onexecutesql, theme = 'light' }: Props = $props();

  let container: HTMLDivElement;
  let editorModel: monaco.editor.ITextModel | undefined = $state();

  $effect(() => {
    if (editorModel) {
      monaco.editor.setModelMarkers(editorModel, "external", markers);
    }
  });

  $effect(() => {
    monaco.editor.setTheme(theme === 'dark' ? "trino-dark" : "trino-light");
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

  function executeStatement(model: monaco.editor.ITextModel, editor: monaco.editor.IStandaloneCodeEditor) {
    if (!onexecutesql) return;

    const selection = editor.getSelection();
    if (selection && !selection.isEmpty()) {
      onexecutesql(model.getValueInRange(selection), selection.startLineNumber);
      return;
    }

    const position = editor.getPosition();
    if (!position) return;

    const cursorOffset = model.getOffsetAt(position);
    const statement = findStatementAtOffset(model, cursorOffset);

    if (statement) {
      onexecutesql(statement.text, statement.startLine);
    }
  }

  function findStatementAtOffset(model: monaco.editor.ITextModel, offset: number) {
    const statements = splitStatements(model.getValue());
    if (statements.length === 0) return null;

    const s = statements.find((s) => offset >= s.startOffset && offset <= s.endOffset);

    // Cursor is past all statements (trailing whitespace after last ";") — use last statement
    const match = s ?? statements[statements.length - 1];
    const leadingWs = match.text.length - match.text.trimStart().length;
    return { text: match.text.trim(), startLine: model.getPositionAt(match.startOffset + leadingWs).lineNumber };
  }

  onMount(() => {
    const disposable = register(monaco, { metadataProvider });
    const model = monaco.editor.createModel(value, "trino-sql");
    editorModel = model;
    const editor = monaco.editor.create(container, {
      model,
      language: "trino-sql",
      theme: theme === 'dark' ? "trino-dark" : "trino-light",
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

    editor.addAction({
      id: "trino.runCurrentStatement",
      label: "Run Current Statement",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => executeStatement(model, editor),
    });

    const runCommand = monaco.editor.registerCommand("trino.runStatement", (_accessor, text: string, startLine: number) => {
      onexecutesql?.(text, startLine);
    });

    const codelensProvider = monaco.languages.registerCodeLensProvider("trino-sql", {
      provideCodeLenses(model) {
        const statements = splitStatements(model.getValue());
        return {
          lenses: statements.map((s) => {
            const leadingWs = s.text.length - s.text.trimStart().length;
            const startLine = model.getPositionAt(s.startOffset + leadingWs).lineNumber;
            return {
              range: new monaco.Range(startLine, 1, startLine, 1),
              command: {
                id: "trino.runStatement",
                title: "▶ Run",
                arguments: [s.text.trim(), startLine],
              },
            };
          }),
          dispose() {},
        };
      },
    });

    return () => {
      codelensProvider.dispose();
      runCommand.dispose();
      editor.dispose();
      model.dispose();
      editorModel = undefined;
      disposable.dispose();
    };
  });
</script>

<div bind:this={container} class="editor-container"></div>

<style>
  .editor-container {
    width: 100%;
    height: 100%;
  }
</style>
