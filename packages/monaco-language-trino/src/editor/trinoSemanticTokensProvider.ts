import * as monaco from 'monaco-editor';
import { ParseTreeWalker, TerminalNode, Token } from 'antlr4ng';
import type { ParserRuleContext, ParseTree } from 'antlr4ng';
import { SqlBaseListener } from '../parser/SqlBaseListener';
import type {
  GenericTypeContext,
  DateTimeTypeContext,
  DoublePrecisionTypeContext,
  IntervalTypeContext,
  RowTypeContext,
  LegacyArrayTypeContext,
  LegacyMapTypeContext,
  ArrayTypeContext,
} from '../parser/SqlBaseParser';
import { SqlBaseLexer } from '../parser/SqlBaseLexer';
import { trinoSemanticIndex, TYPE_INDEX, SEMANTIC_TOKEN_TYPES, SEMANTIC_TOKEN_MODIFIERS } from './trinoTokenMap';
import type { DocumentParseService } from './documentParseService';

export const semanticTokensLegend: monaco.languages.SemanticTokensLegend = {
  tokenTypes: [...SEMANTIC_TOKEN_TYPES],
  tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
};

interface SemanticToken {
  line: number;   // 0-based document line
  start: number;  // 0-based character offset
  length: number;
  tokenType: number;
}

/**
 * Listener that collects tokens within type contexts for semantic highlighting.
 */
class TypeHighlightListener extends SqlBaseListener {
  /** Set of "line:col" keys for tokens that should be marked as type. */
  readonly typePositions = new Set<string>();

  private collectPositions(ctx: ParserRuleContext): void {
    if (!ctx.start || !ctx.stop) return;
    const stack: ParseTree[] = [ctx];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node instanceof TerminalNode) {
        const token = node.symbol;
        if (token.type !== Token.EOF && token.line > 0) {
          // Key using statement-relative position (1-based line, 0-based col)
          this.typePositions.add(`${token.line}:${token.column}`);
        }
      } else {
        const ruleCtx = node as ParserRuleContext;
        if (ruleCtx.children) {
          for (let i = ruleCtx.children.length - 1; i >= 0; i--) {
            stack.push(ruleCtx.children[i]);
          }
        }
      }
    }
  }

  override enterGenericType = (ctx: GenericTypeContext): void => {
    this.collectPositions(ctx);
  };

  override enterDateTimeType = (ctx: DateTimeTypeContext): void => {
    this.collectPositions(ctx);
  };

  override enterDoublePrecisionType = (ctx: DoublePrecisionTypeContext): void => {
    this.collectPositions(ctx);
  };

  override enterIntervalType = (ctx: IntervalTypeContext): void => {
    this.collectPositions(ctx);
  };

  override enterRowType = (ctx: RowTypeContext): void => {
    this.collectPositions(ctx);
  };

  override enterLegacyArrayType = (ctx: LegacyArrayTypeContext): void => {
    this.collectPositions(ctx);
  };

  override enterLegacyMapType = (ctx: LegacyMapTypeContext): void => {
    this.collectPositions(ctx);
  };

  override enterArrayType = (ctx: ArrayTypeContext): void => {
    this.collectPositions(ctx);
  };
}

export class TrinoSemanticTokensProvider implements monaco.languages.DocumentSemanticTokensProvider {

  onDidChange?: monaco.IEvent<void>;

  constructor(private readonly parseService: DocumentParseService) {}

  getLegend(): monaco.languages.SemanticTokensLegend {
    return semanticTokensLegend;
  }

  provideDocumentSemanticTokens(
    model: monaco.editor.ITextModel,
    _lastResultId: string | null,
    token: monaco.CancellationToken,
  ): monaco.languages.SemanticTokens {
    const results = this.parseService.getParseResults(model, token);
    const allTokens: SemanticToken[] = [];

    for (const result of results) {
      if (token.isCancellationRequested) break;

      const stmt = result.slice;

      // Walk parse tree to find type-context tokens
      const listener = new TypeHighlightListener();
      ParseTreeWalker.DEFAULT.walk(listener, result.tree);

      // Emit ALL lexer tokens mapped to semantic token types
      for (const lexerToken of result.tokens) {
        if (lexerToken.type === Token.EOF || lexerToken.type === SqlBaseLexer.WS) {
          continue;
        }

        const tokenText = lexerToken.text ?? '';
        if (tokenText.length === 0) continue;

        // Check if this token is in a type context
        const posKey = `${lexerToken.line}:${lexerToken.column}`;
        let semanticIndex: number | undefined;

        if (listener.typePositions.has(posKey)) {
          semanticIndex = TYPE_INDEX;
        } else {
          semanticIndex = trinoSemanticIndex(lexerToken.type);
        }

        if (semanticIndex === undefined) continue;

        // Convert statement-relative position to document position
        const stmtLine0 = lexerToken.line - 1; // 0-based line within statement
        const docLine = stmtLine0 + stmt.startLine; // 0-based document line
        const docCol = stmtLine0 === 0
          ? lexerToken.column + stmt.startCol
          : lexerToken.column;

        // A semantic token may not cross a line break, nor end past the end of
        // its own line; monaco checks both and logs "Invalid Semantic Tokens
        // Data From Extension" when they do not hold. Two of Trino's lexer
        // rules produce text that does. SIMPLE_COMMENT is
        // `'--' ~[\r\n]* '\r'? '\n'?`, so a line comment swallows the line
        // break that ends it and reaches one character past the line (two on
        // CRLF). BRACKETED_COMMENT is `'/*' .*? '*/'`, which spans as many
        // lines as it likes. Both arrive here, because comments are
        // highlighted, and both put that error in the console on every
        // keystroke. Emitting one token per line the text actually covers is
        // the whole fix: the run after a line comment's break is empty, which
        // is how its newline stops being highlighted.
        if (tokenText.indexOf('\n') === -1 && tokenText.indexOf('\r') === -1) {
          allTokens.push({
            line: docLine,
            start: docCol,
            length: tokenText.length,
            tokenType: semanticIndex,
          });
          continue;
        }

        let pieceLine = docLine;
        let pieceStart = docCol;
        for (const piece of tokenText.split('\n')) {
          // A '\r' at the end belongs to the line break, not to the line.
          const length = piece.endsWith('\r') ? piece.length - 1 : piece.length;
          if (length > 0) {
            allTokens.push({
              line: pieceLine,
              start: pieceStart,
              length,
              tokenType: semanticIndex,
            });
          }
          pieceLine++;
          pieceStart = 0;
        }
      }
    }

    // Sort tokens by position (required for delta encoding)
    allTokens.sort((a, b) => a.line - b.line || a.start - b.start);

    // Encode as delta format: [deltaLine, deltaStartChar, length, tokenType, tokenModifiers]
    const data = new Uint32Array(allTokens.length * 5);
    let prevLine = 0;
    let prevStart = 0;
    for (let i = 0; i < allTokens.length; i++) {
      const t = allTokens[i];
      const deltaLine = t.line - prevLine;
      const deltaStart = deltaLine === 0 ? t.start - prevStart : t.start;
      data[i * 5] = deltaLine;
      data[i * 5 + 1] = deltaStart;
      data[i * 5 + 2] = t.length;
      data[i * 5 + 3] = t.tokenType;
      data[i * 5 + 4] = 0; // no modifiers
      prevLine = t.line;
      prevStart = t.start;
    }

    return { data };
  }

  releaseDocumentSemanticTokens(_resultId: string | undefined): void {
    // nothing to release
  }
}
