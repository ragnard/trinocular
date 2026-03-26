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
  }

  let { value = "", options = {}, metadataProvider, markers = [], onexecutesql }: Props = $props();

  let container: HTMLDivElement;
  let editorModel: monaco.editor.ITextModel | undefined = $state();

  $effect(() => {
    if (editorModel) {
      monaco.editor.setModelMarkers(editorModel, "external", markers);
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
    colors: {

    }
  });

  onMount(() => {
    const disposable = register(monaco, { metadataProvider });
    const model = monaco.editor.createModel(value, "trino-sql");
    editorModel = model;
    const editor = monaco.editor.create(container, {
      model,
      language: "trino-sql",
      theme: "trino-light",
      fontFamily: "monospace",
      minimap: { enabled: false },
      wordBasedSuggestions: "off",
      "semanticHighlighting.enabled": true,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      ...options
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      if (!onexecutesql) return;
      const model = editor.getModel();
      if (!model) return;

      const selection = editor.getSelection();
      if (selection && !selection.isEmpty()) {
        onexecutesql(model.getValueInRange(selection), selection.startLineNumber);
        return;
      }

      const position = editor.getPosition();
      if (!position) return;

      const text = model.getValue();
      const cursorOffset = model.getOffsetAt(position);
      const statements = splitStatements(text);
      const current = statements.find(
        (s) => cursorOffset >= s.startOffset && cursorOffset <= s.endOffset
      );

      if (current) {
        const startLine = model.getPositionAt(current.startOffset).lineNumber;
        onexecutesql(current.text, startLine);
      } else {
        onexecutesql(text, 1);
      }
    });

    return () => {
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
