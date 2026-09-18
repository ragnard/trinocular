import type * as monacoApi from "monaco-editor";
import { TrinoCompletionProvider } from "./trinoCompletionProvider";
import { TrinoSemanticTokensProvider } from "./trinoSemanticTokensProvider";
import { trinoLanguageConfig } from "./trinoLanguageConfig";
import { setupDiagnostics } from "./trinoDiagnosticsProvider";
import { TrinoFoldingProvider } from "./trinoFoldingProvider";
import { DocumentParseService } from "./documentParseService";
import type { MetadataProvider } from "./metadataProvider";

const DEFAULT_LANGUAGE_ID = "trino-sql";

export interface TrinoLanguageOptions {
  languageId?: string;
  metadataProvider?: MetadataProvider;
}

export interface TrinoLanguageRegistration extends monacoApi.IDisposable {
  /**
   * The parse service backing the registered providers. Exposed so a host
   * that also needs statement boundaries (to place code lenses, say) can share
   * this cache instead of re-lexing the document itself — the cache is keyed
   * on the model version, so a host asking for the same version pays nothing.
   */
  readonly parseService: DocumentParseService;
}

export function register(
  monaco: Pick<typeof monacoApi, "languages" | "editor">,
  options?: TrinoLanguageOptions
): TrinoLanguageRegistration {
  const languageId = options?.languageId ?? DEFAULT_LANGUAGE_ID;
  const disposables: monacoApi.IDisposable[] = [];
  const parseService = new DocumentParseService();

  // Register language
  monaco.languages.register({ id: languageId });

  // Language configuration
  disposables.push(monaco.languages.setLanguageConfiguration(languageId, trinoLanguageConfig));

  // Completion provider
  if (options?.metadataProvider) {
    disposables.push(
      monaco.languages.registerCompletionItemProvider(
        languageId,
        new TrinoCompletionProvider(options.metadataProvider, parseService)
      )
    );
  }

  // Semantic tokens provider (replaces the old line-by-line TokensProvider)
  disposables.push(
    monaco.languages.registerDocumentSemanticTokensProvider(
      languageId,
      new TrinoSemanticTokensProvider(parseService)
    )
  );

  // Folding provider (fold each SQL statement)
  disposables.push(
    monaco.languages.registerFoldingRangeProvider(
      languageId,
      new TrinoFoldingProvider(parseService)
    )
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
  disposables.push(monaco.editor.onDidCreateModel(attachDiagnostics));

  return {
    parseService,
    dispose() {
      for (const d of diagnosticsMap.values()) {
        d.dispose();
      }
      diagnosticsMap.clear();
      for (const d of disposables) {
        d.dispose();
      }
      parseService.dispose();
    }
  };
}
