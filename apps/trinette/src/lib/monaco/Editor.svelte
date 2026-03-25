<script lang="ts">
  import { onMount } from "svelte";
  import * as monaco from "monaco-editor";
  import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
  import { register, splitStatements, type MetadataProvider } from "monaco-language-trino";

  interface Props {
    value?: string;
    options?: monaco.editor.IStandaloneEditorConstructionOptions;
    metadataProvider?: MetadataProvider;
    onexecutesql?: (sql: string) => void;
  }

  let { value = "", options = {}, metadataProvider, onexecutesql }: Props = $props();

  let container: HTMLDivElement;

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
        onexecutesql(model.getValueInRange(selection));
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
      onexecutesql(current ? current.text : text);
    });

    return () => {
      editor.dispose();
      model.dispose();
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
