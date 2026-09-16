import { CharStream } from 'antlr4ng';
import { SqlBaseLexer } from '../parser/SqlBaseLexer';

export interface StatementSlice {
  text: string;
  startLine: number;  // 0-based line in the document
  startCol: number;   // 0-based column in the document
  /** Byte offset of the first character in the original document */
  startOffset: number;
  /** Byte offset one past the last character */
  endOffset: number;
}

function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  let line = 0;
  let lastNewline = -1;
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\n') {
      line++;
      lastNewline = i;
    }
  }
  return { line, col: offset - lastNewline - 1 };
}

/**
 * Split SQL text into individual statements using the lexer to find
 * semicolons. This correctly handles semicolons inside string literals.
 *
 * Uses a streaming approach (one token at a time) to avoid allocating
 * the full token array — O(1) memory instead of O(all tokens).
 */
export function splitStatements(text: string): StatementSlice[] {
  const input = CharStream.fromString(text);
  const lexer = new SqlBaseLexer(input);
  lexer.removeErrorListeners();

  const result: StatementSlice[] = [];
  let lastSplitOffset = 0;

  let token = lexer.nextToken();
  while (token.type !== SqlBaseLexer.EOF) {
    if (token.type === SqlBaseLexer.SEMICOLON) {
      const endOffset = token.stop + 1;
      const { line, col } = offsetToLineCol(text, lastSplitOffset);
      result.push({
        text: text.substring(lastSplitOffset, token.start),
        startLine: line,
        startCol: col,
        startOffset: lastSplitOffset,
        endOffset,
      });
      lastSplitOffset = endOffset;
    }
    token = lexer.nextToken();
  }

  if (lastSplitOffset < text.length) {
    const remaining = text.substring(lastSplitOffset);
    if (remaining.trim().length > 0) {
      const { line, col } = offsetToLineCol(text, lastSplitOffset);
      result.push({
        text: remaining,
        startLine: line,
        startCol: col,
        startOffset: lastSplitOffset,
        endOffset: text.length,
      });
    }
  }

  return result;
}
