import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { register, type MetadataProvider } from 'monaco-language-trino';

self.MonacoEnvironment = {
    getWorker: () => new editorWorker(),
};

monaco.editor.defineTheme('trino-light', {
    base: 'vs',
    inherit: true,
    rules: [
        { token: 'keyword', foreground: '0000FF' },
        { token: 'string', foreground: 'A31515' },
        { token: 'number', foreground: '098658' },
        { token: 'comment', foreground: '008000' },
        { token: 'operator', foreground: '000000' },
        { token: 'type', foreground: '267f99' },
        { token: 'identifier', foreground: '001080' },
        { token: 'delimiter', foreground: '000000' },
    ],
    colors: {},
});

export interface CreateEditorOptions {
    container: HTMLElement;
    value: string;
    metadataProvider?: MetadataProvider;
    options?: monaco.editor.IStandaloneEditorConstructionOptions;
}

export function createEditor({ container, value, metadataProvider, options }: CreateEditorOptions) {
    const disposable = register(monaco, { metadataProvider });
    const model = monaco.editor.createModel(value, 'trino-sql');
    const editor = monaco.editor.create(container, {
        model,
        language: 'trino-sql',
        theme: 'trino-light',
        wordBasedSuggestions: 'off',
        'semanticHighlighting.enabled': true,
        ...options,
    });

    return {
        editor,
        dispose() {
            editor.dispose();
            model.dispose();
            disposable.dispose();
        },
    };
}
