import { CharStream } from "antlr4ng";
import { SqlBaseLexer } from "../parser/SqlBaseLexer";
import { SqlBaseParser } from "../parser/SqlBaseParser";

/**
 * The words that can stand as a bare identifier despite being keywords, read
 * off the grammar's `nonReserved` rule: every alternative of that rule is a
 * single token, so the set of tokens that can start it is the whole rule.
 */
let nonReserved: Set<number> | undefined;

function nonReservedTokens(): Set<number> {
  if (!nonReserved) {
    const atn = SqlBaseParser._ATN;
    const start = atn.ruleToStartState[SqlBaseParser.RULE_nonReserved]!;
    nonReserved = new Set(atn.nextTokens(start).toArray());
  }
  return nonReserved;
}

/**
 * Whether `word` is a keyword Trino refuses as a bare identifier. Decided by
 * the lexer and the grammar, so it cannot drift from what the parser accepts.
 */
export function isReservedWord(word: string): boolean {
  const lexer = new SqlBaseLexer(CharStream.fromString(word));
  lexer.removeErrorListeners();
  const tokens = lexer.getAllTokens();
  if (tokens.length !== 1) return false;
  const type = tokens[0].type;
  if (type === SqlBaseParser.IDENTIFIER) return false;
  return !nonReservedTokens().has(type);
}

const BARE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * `name` as it has to be written in SQL to mean exactly this name. Unquoted
 * identifiers are lowercased by Trino, so anything with a capital letter is
 * quoted as much as anything with a space.
 */
export function quoteIdentifier(name: string): string {
  if (BARE_IDENTIFIER.test(name) && !isReservedWord(name)) return name;
  return `"${name.replace(/"/g, '""')}"`;
}

export function qualifiedName(...parts: string[]): string {
  return parts.map(quoteIdentifier).join(".");
}
