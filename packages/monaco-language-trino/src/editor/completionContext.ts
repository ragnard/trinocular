import { CharStream, CommonTokenStream, Token } from "antlr4ng";
import { CodeCompletionCore, type CandidatesCollection } from "antlr4-c3";
import { SqlBaseLexer } from "../parser/SqlBaseLexer";
import { SqlBaseParser } from "../parser/SqlBaseParser";
import { keywordMap } from "./trinoKeywordMap";
import type { FunctionKind } from "./metadataProvider";

/**
 * What the grammar has to say about the caret. This is the whole of completion
 * that does not touch monaco — the lexing, the caret index and the c3 run — and
 * it is a module of its own so that it can be tested: the rule stack this reads
 * is the one thing here that a regenerated parser could silently change.
 */
export interface CompletionContext {
  candidates: CandidatesCollection;
  /** The statement's real tokens, for walking a dotted name back from the caret. */
  onChannelTokens: Token[];
}

const DOT_TOKEN = SqlBaseLexer.T__0; // '.'

/** What an expression may call. A table function may not be one of them. */
export const EXPRESSION_FUNCTIONS: ReadonlySet<FunctionKind> = new Set<FunctionKind>([
  "scalar",
  "aggregate",
  "window"
]);

/** What `TABLE(...)` may call, which is only ever the other one. */
export const TABLE_FUNCTIONS: ReadonlySet<FunctionKind> = new Set<FunctionKind>(["table"]);

/**
 * `statementText` is the statement up to the caret and `prefix` is the word
 * being typed, upper-cased — monaco's `getWordUntilPosition`, which is also
 * what the caller filters the suggestions with.
 */
export function collectContext(statementText: string, prefix: string): CompletionContext {
  const lexer = new SqlBaseLexer(CharStream.fromString(statementText));
  lexer.removeErrorListeners();
  const tokenStream = new CommonTokenStream(lexer);
  tokenStream.fill();

  const allTokens = tokenStream.getTokens();
  const onChannelTokens = allTokens.filter((t) => t.channel === 0 && t.type !== Token.EOF);

  // Default: the caret is past all tokens — use EOF's tokenIndex so c3 collects
  // what is valid at the end of the input. The index has to be a raw token
  // stream index, since c3 compares it against token.tokenIndex.
  const eofToken = allTokens.find((t) => t.type === Token.EOF);
  let caretTokenIndex = eofToken?.tokenIndex ?? allTokens.length;

  // Mid-word, point at the word itself, so c3 computes what is valid *there*
  // rather than after it.
  if (prefix.length > 0 && onChannelTokens.length > 0) {
    const lastToken = onChannelTokens[onChannelTokens.length - 1];
    if (lastToken.type === SqlBaseLexer.IDENTIFIER && lastToken.text?.toUpperCase() === prefix) {
      caretTokenIndex = lastToken.tokenIndex;
    }
  }

  const parser = new SqlBaseParser(tokenStream);
  parser.removeErrorListeners();
  const core = new CodeCompletionCore(parser);
  core.ignoredTokens = new Set([
    SqlBaseLexer.WS,
    SqlBaseLexer.SIMPLE_COMMENT,
    SqlBaseLexer.BRACKETED_COMMENT,
    SqlBaseLexer.UNRECOGNIZED
  ]);
  core.preferredRules = new Set([SqlBaseParser.RULE_qualifiedName, SqlBaseParser.RULE_identifier]);

  return { candidates: core.collectCandidates(caretTokenIndex), onChannelTokens };
}

/**
 * Which function kinds may be written where the caret is, or nothing if a
 * function may not be.
 *
 * A function call is `qualifiedName '('` under `primaryExpression`, a table
 * function is the same rule under `tableFunctionCall`, and a table is it under
 * `relationPrimary` — so the parent the candidate was reached through is the
 * whole distinction, and c3 hands it over as `ruleList`. Without reading it
 * every `qualifiedName` candidate looks alike, which is why `SELECT ab` used to
 * offer catalogs and tables and no function at all.
 *
 * Only the innermost frame is read. The rest of the stack is the path down from
 * `singleStatement` and says nothing a nearer frame has not already settled.
 */
export function functionKindsAt(
  candidates: CandidatesCollection
): ReadonlySet<FunctionKind> | undefined {
  const candidate = candidates.rules.get(SqlBaseParser.RULE_qualifiedName);
  if (!candidate) return undefined;
  switch (candidate.ruleList.at(-1)) {
    case SqlBaseParser.RULE_primaryExpression:
      return EXPRESSION_FUNCTIONS;
    case SqlBaseParser.RULE_tableFunctionCall:
      return TABLE_FUNCTIONS;
    default:
      return undefined;
  }
}

/**
 * The dot-separated parts standing before the caret, walked back from the end
 * of the on-channel tokens: `tpch.tiny.` and `tpch.tiny.cus` both give
 * `["tpch", "tiny"]`. What the user is part-way through typing is never one of
 * them — that is `prefix`, which the caller filters with.
 */
export function dottedParts(onChannelTokens: Token[], prefix: string): string[] {
  const isNamePart = (token: Token) =>
    token.type === SqlBaseLexer.IDENTIFIER || keywordMap.has(token.type);

  // The caret sits on a dot: every part before it is complete.
  const last = onChannelTokens[onChannelTokens.length - 1];
  if (last?.type === DOT_TOKEN && prefix.length === 0) {
    const parts: string[] = [];
    let j = onChannelTokens.length - 2;
    while (j >= 0 && isNamePart(onChannelTokens[j])) {
      parts.unshift(onChannelTokens[j].text ?? "");
      j--;
      if (j >= 0 && onChannelTokens[j].type === DOT_TOKEN) j--;
      else break;
    }
    return parts;
  }

  const parts: string[] = [];
  let i = onChannelTokens.length - 1;

  // Skip the word being typed; it is the prefix, not a completed part.
  if (
    i >= 0 &&
    prefix.length > 0 &&
    onChannelTokens[i].type === SqlBaseLexer.IDENTIFIER &&
    onChannelTokens[i].text?.toUpperCase() === prefix
  ) {
    i--;
  }

  // Then DOT IDENTIFIER pairs, right to left.
  while (i >= 1 && onChannelTokens[i].type === DOT_TOKEN && isNamePart(onChannelTokens[i - 1])) {
    parts.unshift(onChannelTokens[i - 1].text ?? "");
    i -= 2;
  }
  return parts;
}
