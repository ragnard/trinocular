import { SqlBaseParser } from "../parser/SqlBaseParser";

const NON_KEYWORD_TOKENS = new Set([
  SqlBaseParser.EQ,
  SqlBaseParser.NEQ,
  SqlBaseParser.LT,
  SqlBaseParser.LTE,
  SqlBaseParser.GT,
  SqlBaseParser.GTE,
  SqlBaseParser.PLUS,
  SqlBaseParser.MINUS,
  SqlBaseParser.ASTERISK,
  SqlBaseParser.SLASH,
  SqlBaseParser.PERCENT,
  SqlBaseParser.CONCAT,
  SqlBaseParser.QUESTION_MARK,
  SqlBaseParser.SEMICOLON,
  SqlBaseParser.STRING,
  SqlBaseParser.UNICODE_STRING,
  SqlBaseParser.DOLLAR_STRING,
  SqlBaseParser.BINARY_LITERAL,
  SqlBaseParser.INTEGER_VALUE,
  SqlBaseParser.DECIMAL_VALUE,
  SqlBaseParser.DOUBLE_VALUE,
  SqlBaseParser.IDENTIFIER,
  SqlBaseParser.DIGIT_IDENTIFIER,
  SqlBaseParser.QUOTED_IDENTIFIER,
  SqlBaseParser.BACKQUOTED_IDENTIFIER,
  SqlBaseParser.SIMPLE_COMMENT,
  SqlBaseParser.BRACKETED_COMMENT,
  SqlBaseParser.WS,
  SqlBaseParser.UNRECOGNIZED,
  SqlBaseParser.DELIMITER
]);

const keywordMap = new Map<number, string>();
for (let i = 0; i < SqlBaseParser.symbolicNames.length; i++) {
  const name = SqlBaseParser.symbolicNames[i];
  if (name && !NON_KEYWORD_TOKENS.has(i)) {
    keywordMap.set(i, name);
  }
}

export { keywordMap };
