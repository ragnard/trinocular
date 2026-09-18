import { SqlBaseLexer } from "../parser/SqlBaseLexer";

// Maps ANTLR token type IDs to Monaco token scope strings.

const L = SqlBaseLexer;

const explicitTokenScopes = new Map<number, string>([
  // Punctuation (anonymous tokens from grammar literal declarations)
  [L.T__0, "delimiter"], // '.'
  [L.T__1, "delimiter"], // '('
  [L.T__2, "delimiter"], // ')'
  [L.T__3, "delimiter"], // ','
  [L.T__4, "delimiter"], // '@'
  [L.T__5, "delimiter"], // 'SKIP'
  [L.T__6, "delimiter"], // '=>'
  [L.T__7, "delimiter"], // '->'
  [L.T__8, "delimiter"], // '['
  [L.T__9, "delimiter"], // ']'
  [L.T__10, "delimiter"], // ':'
  [L.T__11, "delimiter"], // '|'
  [L.T__12, "delimiter"], // '^'
  [L.T__13, "delimiter"], // '$'
  [L.T__14, "delimiter"], // '{-'
  [L.T__15, "delimiter"], // '-}'
  [L.T__16, "delimiter"], // '{'
  [L.T__17, "delimiter"], // '}'

  // Operators
  [L.EQ, "operator"],
  [L.NEQ, "operator"],
  [L.LT, "operator"],
  [L.LTE, "operator"],
  [L.GT, "operator"],
  [L.GTE, "operator"],
  [L.PLUS, "operator"],
  [L.MINUS, "operator"],
  [L.ASTERISK, "operator"],
  [L.SLASH, "operator"],
  [L.PERCENT, "operator"],
  [L.CONCAT, "operator"],
  [L.QUESTION_MARK, "operator"],

  // Semicolon
  [L.SEMICOLON, "delimiter"],

  // String literals
  [L.STRING, "string"],
  [L.UNICODE_STRING, "string"],
  [L.DOLLAR_STRING, "string"],
  [L.BINARY_LITERAL, "string"],

  // Number literals
  [L.INTEGER_VALUE, "number"],
  [L.DECIMAL_VALUE, "number"],
  [L.DOUBLE_VALUE, "number"],

  // Identifiers
  [L.IDENTIFIER, "identifier"],
  [L.DIGIT_IDENTIFIER, "identifier"],
  [L.QUOTED_IDENTIFIER, "identifier.quote"],
  [L.BACKQUOTED_IDENTIFIER, "identifier.quote"],

  // Comments
  [L.SIMPLE_COMMENT, "comment"],
  [L.BRACKETED_COMMENT, "comment"]

  // WS and UNRECOGNIZED map to empty string (default)
]);

// Build full map: explicit entries + all remaining named tokens as keywords
const tokenMap = new Map<number, string>(explicitTokenScopes);
for (let i = 0; i < L.symbolicNames.length; i++) {
  if (L.symbolicNames[i] && !tokenMap.has(i)) {
    tokenMap.set(i, "keyword");
  }
}

export function trinoTokenType(tokenType: number): string {
  return tokenMap.get(tokenType) ?? "";
}

// Semantic token legend types — indices into the TOKEN_TYPES array
// used by the DocumentSemanticTokensProvider.
export const SEMANTIC_TOKEN_TYPES = [
  "keyword",
  "string",
  "number",
  "comment",
  "operator",
  "type",
  "identifier",
  "delimiter"
] as const;

export const SEMANTIC_TOKEN_MODIFIERS = ["quoted"] as const;

const KEYWORD_INDEX = 0;
const STRING_INDEX = 1;
const NUMBER_INDEX = 2;
const COMMENT_INDEX = 3;
const OPERATOR_INDEX = 4;
export const TYPE_INDEX = 5;
const IDENTIFIER_INDEX = 6;
const DELIMITER_INDEX = 7;

const scopeToSemanticIndex = new Map<string, number>([
  ["keyword", KEYWORD_INDEX],
  ["string", STRING_INDEX],
  ["number", NUMBER_INDEX],
  ["comment", COMMENT_INDEX],
  ["operator", OPERATOR_INDEX],
  ["type", TYPE_INDEX],
  ["identifier", IDENTIFIER_INDEX],
  ["identifier.quote", IDENTIFIER_INDEX],
  ["delimiter", DELIMITER_INDEX]
]);

/**
 * Maps an ANTLR token type to a semantic token legend index.
 * Returns `undefined` for WS/EOF/unrecognized tokens (skip those).
 */
export function trinoSemanticIndex(antlrTokenType: number): number | undefined {
  const scope = trinoTokenType(antlrTokenType);
  if (!scope) return undefined;
  return scopeToSemanticIndex.get(scope);
}
