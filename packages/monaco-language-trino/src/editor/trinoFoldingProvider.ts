import type * as monacoApi from "monaco-editor";
import type { DocumentParseService } from "./documentParseService";

export class TrinoFoldingProvider implements monacoApi.languages.FoldingRangeProvider {
  constructor(private parseService: DocumentParseService) {}

  provideFoldingRanges(
    model: monacoApi.editor.ITextModel,
    _context: monacoApi.languages.FoldingContext,
    _token: monacoApi.CancellationToken
  ): monacoApi.languages.FoldingRange[] {
    const statements = this.parseService.getStatements(model);
    const ranges: monacoApi.languages.FoldingRange[] = [];

    for (const stmt of statements) {
      // Use model to get accurate 1-based line numbers from offsets.
      // Skip leading whitespace so the fold starts at the first real token.
      const trimmedStart = stmt.startOffset + (stmt.text.length - stmt.text.trimStart().length);
      const trimmedEnd = stmt.startOffset + stmt.text.trimEnd().length;

      const startLine = model.getPositionAt(trimmedStart).lineNumber;
      const endLine = model.getPositionAt(trimmedEnd).lineNumber;

      if (endLine <= startLine) continue;

      ranges.push({ start: startLine, end: endLine });
    }

    return ranges;
  }
}
