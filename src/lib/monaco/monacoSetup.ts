// Custom Monaco editor build — only the features we need.
// No built-in languages, no diff editor, no language servers.

// Core editor
import "monaco-editor/editor/editor.api.js";
import "monaco-editor/editor/browser/coreCommands.js";
import "monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget.js";

// Editor features we actually use
import "monaco-editor/editor/contrib/codelens/browser/codelensController.js";
import "monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js";
import "monaco-editor/editor/contrib/clipboard/browser/clipboard.js";
import "monaco-editor/editor/contrib/comment/browser/comment.js";
import "monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js";
import "monaco-editor/editor/contrib/find/browser/findController.js";
import "monaco-editor/editor/contrib/folding/browser/folding.js";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution.js";
import "monaco-editor/editor/contrib/indentation/browser/indentation.js";
import "monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js";
import "monaco-editor/editor/contrib/multicursor/browser/multicursor.js";
import "monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens.js";
import "monaco-editor/editor/contrib/semanticTokens/browser/viewportSemanticTokens.js";
import "monaco-editor/editor/contrib/suggest/browser/suggestController.js";
import "monaco-editor/editor/contrib/tokenization/browser/tokenization.js";
import "monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js";
import "monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js";

// Standalone features
import "monaco-editor/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess.js";

// Codicons
import "monaco-editor/editor/common/standaloneStrings.js";
import "monaco-editor/features/codicon/register.js";

// Re-export the typed API
export * from "monaco-editor/editor/editor.api.js";
