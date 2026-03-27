import type * as monacoApi from 'monaco-editor';
import { TrinoCompletionProvider } from './trinoCompletionProvider';
import { TrinoSemanticTokensProvider } from './trinoSemanticTokensProvider';
import { trinoLanguageConfig } from './trinoLanguageConfig';
import { setupDiagnostics } from './trinoDiagnosticsProvider';
import { TrinoFoldingProvider } from './trinoFoldingProvider';
import { DocumentParseService } from './documentParseService';
import type { MetadataProvider } from './metadataProvider';

const DEFAULT_LANGUAGE_ID = 'trino-sql';

export interface TrinoLanguageOptions {
  languageId?: string;
  metadataProvider?: MetadataProvider;
}

export function register(
  monaco: Pick<typeof monacoApi, 'languages' | 'editor'>,
  options?: TrinoLanguageOptions,
): monacoApi.IDisposable {
  const languageId = options?.languageId ?? DEFAULT_LANGUAGE_ID;
  const disposables: monacoApi.IDisposable[] = [];
  const parseService = new DocumentParseService();

  // Register language
  monaco.languages.register({ id: languageId });

  // Language configuration
  disposables.push(
    monaco.languages.setLanguageConfiguration(languageId, trinoLanguageConfig),
  );

  // Completion provider
  if (options?.metadataProvider) {
    disposables.push(
      monaco.languages.registerCompletionItemProvider(
        languageId,
        new TrinoCompletionProvider(options.metadataProvider, parseService),
      ),
    );
  }

  // Semantic tokens provider (replaces the old line-by-line TokensProvider)
  disposables.push(
    monaco.languages.registerDocumentSemanticTokensProvider(
      languageId,
      new TrinoSemanticTokensProvider(parseService),
    ),
  );

  // Folding provider (fold each SQL statement)
  disposables.push(
    monaco.languages.registerFoldingRangeProvider(
      languageId,
      new TrinoFoldingProvider(parseService),
    ),
  );

  // Auto-attach diagnostics to models with matching language
  const diagnosticsMap = new Map<string, monacoApi.IDisposable>();

  const attachDiagnostics = (model: monacoApi.editor.ITextModel) => {
    if (model.getLanguageId() !== languageId) return;
    const uri = model.uri.toString();
    if (diagnosticsMap.has(uri)) return;

    const diagDisposable = setupDiagnostics(model, parseService);
    diagnosticsMap.set(uri, diagDisposable);

    model.onWillDispose(() => {
      diagnosticsMap.get(uri)?.dispose();
      diagnosticsMap.delete(uri);
    });
  };

  // Attach to existing models
  for (const model of monaco.editor.getModels()) {
    attachDiagnostics(model);
  }

  // Attach to future models
  disposables.push(
    monaco.editor.onDidCreateModel(attachDiagnostics),
  );

  return {
    dispose() {
      for (const d of diagnosticsMap.values()) {
        d.dispose();
      }
      diagnosticsMap.clear();
      for (const d of disposables) {
        d.dispose();
      }
      parseService.dispose();
    },
  };
}
