// Core setup
export { register } from "./editor/register";
export type { TrinoLanguageOptions, TrinoLanguageRegistration } from "./editor/register";

// Individual providers (for advanced/custom usage)
export { TrinoCompletionProvider } from "./editor/trinoCompletionProvider";
export {
  TrinoSemanticTokensProvider,
  semanticTokensLegend
} from "./editor/trinoSemanticTokensProvider";
export { setupDiagnostics } from "./editor/trinoDiagnosticsProvider";
export { TrinoFoldingProvider } from "./editor/trinoFoldingProvider";
export { trinoLanguageConfig } from "./editor/trinoLanguageConfig";
export { DocumentParseService } from "./editor/documentParseService";
export type { StatementParseResult, CollectedError } from "./editor/documentParseService";

// Metadata interface for custom completion sources
export type { MetadataProvider } from "./editor/metadataProvider";
export { StaticMetadataProvider } from "./editor/metadataProvider";

// Utilities
export { splitStatements } from "./editor/splitStatements";
export type { StatementSlice } from "./editor/splitStatements";

// Writing names back into SQL
export { isReservedWord, quoteIdentifier, qualifiedName } from "./editor/identifiers";
