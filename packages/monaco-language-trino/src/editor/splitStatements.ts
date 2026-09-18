import { CharStream } from "antlr4ng";
import { SqlBaseLexer } from "../parser/SqlBaseLexer";

export interface StatementSlice {
  text: string;
  startLine: number; // 0-based line in the document
  startCol: number; // 0-based column in the document
  /** Byte offset of the first character in the original document */
  startOffset: number;
  /** Byte offset one past the last character */
  endOffset: number;
}

/**
 * Split SQL text into individual statements using the lexer to find
 * semicolons. This correctly handles semicolons inside string literals.
 *
 * Uses a streaming approach (one token at a time) to avoid allocating
 * the full token array — O(1) memory instead of O(all tokens).
 *
 * A statement's line and column come from the lexer, which tracks both as it
 * goes: the statement after a semicolon starts on that token's line, one
 * column on (a token's line is 1-based, its column 0-based). It used to be
 * recovered by counting newlines from the top of the document for every
 * statement, which made splitting quadratic in the number of statements —
 * and this runs on every keystroke, since the toolbars are re-anchored on
 * each edit.
 */
export function splitStatements(text: string): StatementSlice[] {
  const input = CharStream.fromString(text);
  const lexer = new SqlBaseLexer(input);
  lexer.removeErrorListeners();

  const result: StatementSlice[] = [];
  let lastSplitOffset = 0;
  let line = 0;
  let col = 0;

  let token = lexer.nextToken();
  while (token.type !== SqlBaseLexer.EOF) {
    if (token.type === SqlBaseLexer.SEMICOLON) {
      const endOffset = token.stop + 1;
      result.push({
        text: text.substring(lastSplitOffset, token.start),
        startLine: line,
        startCol: col,
        startOffset: lastSplitOffset,
        endOffset
      });
      lastSplitOffset = endOffset;
      line = token.line - 1;
      col = token.column + 1;
    }
    token = lexer.nextToken();
  }

  if (lastSplitOffset < text.length) {
    const remaining = text.substring(lastSplitOffset);
    if (remaining.trim().length > 0) {
      result.push({
        text: remaining,
        startLine: line,
        startCol: col,
        startOffset: lastSplitOffset,
        endOffset: text.length
      });
    }
  }

  return result;
}
