import * as monaco from 'monaco-editor';
import { CharStream, CommonTokenStream } from 'antlr4ng';
import type { ANTLRErrorListener, ATNSimulator, ParserRuleContext, RecognitionException, Recognizer, Token } from 'antlr4ng';
import { SqlBaseLexer } from '../parser/SqlBaseLexer';
import { SqlBaseParser } from '../parser/SqlBaseParser';
import { splitStatements, type StatementSlice } from './splitStatements';

export interface CollectedError {
  line: number;          // 1-based (from ANTLR)
  column: number;        // 0-based (from ANTLR)
  message: string;
  offendingSymbol: Token | null;
}

export class ErrorCollector implements ANTLRErrorListener {
  readonly errors: CollectedError[] = [];

  syntaxError<S extends Token, T extends ATNSimulator>(
    _recognizer: Recognizer<T>,
    offendingSymbol: S | null,
    line: number,
    charPositionInLine: number,
    msg: string,
    _e: RecognitionException | null,
  ): void {
    this.errors.push({
      line,
      column: charPositionInLine,
      message: msg,
      offendingSymbol: offendingSymbol as Token | null,
    });
  }

  reportAmbiguity(): void { /* not relevant for diagnostics */ }
  reportAttemptingFullContext(): void { /* not relevant for diagnostics */ }
  reportContextSensitivity(): void { /* not relevant for diagnostics */ }
}

export interface StatementParseResult {
  slice: StatementSlice;
  tree: ParserRuleContext;
  tokens: Token[];          // all lexer tokens for the statement
  errors: CollectedError[];
}

interface CacheEntry {
  versionId: number;
  statements: StatementSlice[];
  parseResults: StatementParseResult[];
}

/** Cache keyed by statement text, for cross-version reuse. */
interface StatementCache {
  tree: ParserRuleContext;
  tokens: Token[];
  errors: CollectedError[];
}

export class DocumentParseService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly statementCache = new Map<string, StatementCache>();
  private readonly disposeListeners = new Map<string, monaco.IDisposable>();

  /**
   * Get lightweight statement slices (no full parse).
   * Uses the cached split if the version hasn't changed.
   */
  getStatements(model: monaco.editor.ITextModel): StatementSlice[] {
    const uri = model.uri.toString();
    const versionId = model.getVersionId();
    const cached = this.cache.get(uri);
    if (cached && cached.versionId === versionId) {
      return cached.statements;
    }
    // Need to recompute — splitStatements only, no full parse
    const statements = splitStatements(model.getValue());
    // Don't create a full cache entry yet; just update statements
    if (cached) {
      cached.versionId = versionId;
      cached.statements = statements;
      cached.parseResults = []; // invalidate parse results
    } else {
      this.cache.set(uri, { versionId, statements, parseResults: [] });
      this.listenForDispose(model);
    }
    return statements;
  }

  /**
   * Get full parse results for all statements. Reuses cached results
   * for statements whose text hasn't changed (statement-level invalidation).
   */
  getParseResults(
    model: monaco.editor.ITextModel,
    cancel?: monaco.CancellationToken,
  ): StatementParseResult[] {
    const uri = model.uri.toString();
    const versionId = model.getVersionId();
    const cached = this.cache.get(uri);

    if (cached && cached.versionId === versionId && cached.parseResults.length > 0) {
      return cached.parseResults;
    }

    const statements = this.getStatements(model);
    const results: StatementParseResult[] = [];

    for (const stmt of statements) {
      if (cancel?.isCancellationRequested) {
        break;
      }

      // Check statement-level cache by text
      const stmtCached = this.statementCache.get(stmt.text);
      if (stmtCached) {
        results.push({
          slice: stmt,
          tree: stmtCached.tree,
          tokens: stmtCached.tokens,
          errors: stmtCached.errors,
        });
        continue;
      }

      // Parse the statement
      const input = CharStream.fromString(stmt.text);
      const lexer = new SqlBaseLexer(input);
      lexer.removeErrorListeners();
      const tokenStream = new CommonTokenStream(lexer);
      const parser = new SqlBaseParser(tokenStream);
      parser.removeErrorListeners();

      const errorCollector = new ErrorCollector();
      parser.addErrorListener(errorCollector);

      const tree = parser.singleStatement();

      // Collect all tokens (fill first to ensure all tokens are read)
      tokenStream.fill();
      const tokens = tokenStream.getTokens();

      const stmtResult: StatementCache = {
        tree,
        tokens,
        errors: errorCollector.errors,
      };

      // Cache by statement text
      this.statementCache.set(stmt.text, stmtResult);

      results.push({
        slice: stmt,
        ...stmtResult,
      });
    }

    // Update document-level cache
    const entry = this.cache.get(uri);
    if (entry) {
      entry.parseResults = results;
    }

    return results;
  }

  private listenForDispose(model: monaco.editor.ITextModel): void {
    const uri = model.uri.toString();
    if (this.disposeListeners.has(uri)) return;
    const listener = model.onWillDispose(() => {
      this.cache.delete(uri);
      this.disposeListeners.get(uri)?.dispose();
      this.disposeListeners.delete(uri);
    });
    this.disposeListeners.set(uri, listener);
  }

  dispose(): void {
    this.cache.clear();
    this.statementCache.clear();
    for (const listener of this.disposeListeners.values()) {
      listener.dispose();
    }
    this.disposeListeners.clear();
  }
}
