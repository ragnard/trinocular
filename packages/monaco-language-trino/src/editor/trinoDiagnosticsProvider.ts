import * as monaco from "monaco-editor";
import type { DocumentParseService } from "./documentParseService";

const PARSER_OWNER = "trino-parser";
const DEBOUNCE_MS = 300;

function computeMarkers(
  model: monaco.editor.ITextModel,
  parseService: DocumentParseService
): monaco.editor.IMarkerData[] {
  const results = parseService.getParseResults(model);
  const markers: monaco.editor.IMarkerData[] = [];

  for (const result of results) {
    const stmt = result.slice;

    for (const err of result.errors) {
      // ANTLR line is 1-based within the statement fragment.
      // Convert to document-level 1-based line number.
      const stmtLine0 = err.line - 1; // 0-based line within statement
      const docLine = stmtLine0 + stmt.startLine + 1; // 1-based document line

      const col =
        stmtLine0 === 0
          ? err.column + stmt.startCol + 1 // 1-based Monaco column
          : err.column + 1;

      // Determine end position from the offending token if available
      let endLine = docLine;
      let endCol = col + 1;
      if (err.offendingSymbol && err.offendingSymbol.text) {
        const tokenText = err.offendingSymbol.text;
        const tokenLength = tokenText.length;
        endCol = col + Math.max(tokenLength, 1);
      }

      markers.push({
        severity: monaco.MarkerSeverity.Error,
        startLineNumber: docLine,
        startColumn: col,
        endLineNumber: endLine,
        endColumn: endCol,
        message: err.message,
        source: PARSER_OWNER
      });
    }
  }

  return markers;
}

export function setupDiagnostics(
  model: monaco.editor.ITextModel,
  parseService: DocumentParseService
): monaco.IDisposable {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const runDiagnostics = () => {
    const markers = computeMarkers(model, parseService);
    monaco.editor.setModelMarkers(model, PARSER_OWNER, markers);
  };

  // Run once immediately
  runDiagnostics();

  const disposable = model.onDidChangeContent(() => {
    clearTimeout(timer);
    timer = setTimeout(runDiagnostics, DEBOUNCE_MS);
  });

  return {
    dispose() {
      clearTimeout(timer);
      disposable.dispose();
      monaco.editor.setModelMarkers(model, PARSER_OWNER, []);
    }
  };
}
