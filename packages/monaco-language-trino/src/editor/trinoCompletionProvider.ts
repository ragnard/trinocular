import * as monaco from 'monaco-editor';
import { CharStream, CommonTokenStream, Token } from 'antlr4ng';
import { CodeCompletionCore } from 'antlr4-c3';
import { SqlBaseLexer } from '../parser/SqlBaseLexer';
import { SqlBaseParser } from '../parser/SqlBaseParser';
import { keywordMap } from './trinoKeywordMap';
import type { MetadataProvider } from './metadataProvider';
import type { DocumentParseService } from './documentParseService';

// Built-in Trino type names. These are parsed as identifiers (not keywords)
// via GenericTypeContext, so they won't appear in c3's token candidates.
// Suggested when the grammar expects an identifier.
const TRINO_TYPES = [
  'BIGINT',
  'BOOLEAN',
  'CHAR',
  'DATE',
  'DECIMAL',
  'DOUBLE',
  'INTEGER',
  'INT',
  'IPADDRESS',
  'JSON',
  'REAL',
  'SMALLINT',
  'TINYINT',
  'UUID',
  'VARBINARY',
  'VARCHAR',
];

const DOT_TOKEN = SqlBaseLexer.T__0; // '.'

const RETRIGGER_COMMAND: monaco.languages.Command = {
  id: 'editor.action.triggerSuggest',
  title: 'Re-trigger',
};

function makeSuggestion(
  label: string,
  kind: monaco.languages.CompletionItemKind,
  range: monaco.IRange,
  options?: {
    detail?: string;
    insertText?: string;
    command?: monaco.languages.Command;
  },
): monaco.languages.CompletionItem {
  return {
    label,
    kind,
    insertText: options?.insertText ?? label,
    range,
    ...(options?.detail && { detail: options.detail }),
    ...(options?.command && { command: options.command }),
  };
}

export class TrinoCompletionProvider implements monaco.languages.CompletionItemProvider {
  triggerCharacters = ['.'];

  constructor(
    private readonly metadataProvider: MetadataProvider,
    private readonly parseService: DocumentParseService,
  ) {}

  async provideCompletionItems(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    _context: monaco.languages.CompletionContext,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.CompletionList> {
    const fullText = model.getValue();
    const cursorOffset = model.getOffsetAt(position);

    // Use cached statement splits from the parse service
    const statements = this.parseService.getStatements(model);
    const currentStmt = statements.find(
      s => cursorOffset >= s.startOffset && cursorOffset <= s.endOffset,
    );
    const statementText = currentStmt
      ? fullText.substring(currentStmt.startOffset, cursorOffset)
      : fullText.substring(0, cursorOffset);

    // Lex the current statement
    const input = CharStream.fromString(statementText);
    const lexer = new SqlBaseLexer(input);
    lexer.removeErrorListeners();
    const tokenStream = new CommonTokenStream(lexer);
    tokenStream.fill();

    // Get prefix using Monaco's word detection
    const wordInfo = model.getWordUntilPosition(position);
    const prefix = wordInfo.word.toUpperCase();

    // Find caret token index (must be a raw token stream index, since
    // c3 compares token.tokenIndex against caretTokenIndex).
    const allTokens = tokenStream.getTokens();
    const onChannelTokens = allTokens.filter(
      t => t.channel === 0 && t.type !== Token.EOF,
    );

    // Default: caret is past all tokens — use EOF's tokenIndex so c3
    // collects what's valid at the end of the input.
    const eofToken = allTokens.find(t => t.type === Token.EOF);
    let caretTokenIndex = eofToken?.tokenIndex ?? allTokens.length;

    // If the last on-channel token is an IDENTIFIER whose text matches the prefix,
    // use its tokenIndex so c3 computes what's valid *at* that position
    if (prefix.length > 0 && onChannelTokens.length > 0) {
      const lastToken = onChannelTokens[onChannelTokens.length - 1];
      if (lastToken.type === SqlBaseLexer.IDENTIFIER &&
          lastToken.text?.toUpperCase() === prefix) {
        caretTokenIndex = lastToken.tokenIndex;
      }
    }

    // Run CodeCompletionCore
    const parser = new SqlBaseParser(tokenStream);
    parser.removeErrorListeners();
    const core = new CodeCompletionCore(parser);
    core.ignoredTokens = new Set([
      SqlBaseLexer.WS,
      SqlBaseLexer.SIMPLE_COMMENT,
      SqlBaseLexer.BRACKETED_COMMENT,
      SqlBaseLexer.UNRECOGNIZED,
    ]);
    core.preferredRules = new Set([
      SqlBaseParser.RULE_qualifiedName,
      SqlBaseParser.RULE_identifier,
    ]);
    const candidates = core.collectCandidates(caretTokenIndex);

    // Convert candidates to completion items
    const wordRange = new monaco.Range(
      position.lineNumber,
      wordInfo.startColumn,
      position.lineNumber,
      wordInfo.endColumn,
    );

    const suggestions: monaco.languages.CompletionItem[] = [];
    for (const [tokenType] of candidates.tokens) {
      const keyword = keywordMap.get(tokenType);
      if (!keyword) continue;
      if (prefix.length > 0 && !keyword.startsWith(prefix)) continue;
      suggestions.push(makeSuggestion(keyword, monaco.languages.CompletionItemKind.Keyword, wordRange));
    }

    // When the grammar expects an identifier, suggest built-in type names.
    if (candidates.rules.has(SqlBaseParser.RULE_identifier)) {
      for (const typeName of TRINO_TYPES) {
        if (prefix.length > 0 && !typeName.startsWith(prefix)) continue;
        suggestions.push(makeSuggestion(typeName, monaco.languages.CompletionItemKind.TypeParameter, wordRange));
      }
    }

    // Dynamic metadata completions when grammar expects a name
    if (candidates.rules.has(SqlBaseParser.RULE_qualifiedName) ||
        candidates.rules.has(SqlBaseParser.RULE_identifier)) {
      const metaSuggestions = await this.getMetadataCompletions(
        onChannelTokens, prefix, wordRange,
      );
      suggestions.push(...metaSuggestions);
    }

    return { suggestions };
  }

  /**
   * Parse dot-separated parts from tokens before cursor, then suggest
   * catalogs/schemas/tables based on how many parts have been typed.
   */
  private async getMetadataCompletions(
    onChannelTokens: Token[],
    prefix: string,
    wordRange: monaco.IRange,
  ): Promise<monaco.languages.CompletionItem[]> {
    // Walk backwards from the end of on-channel tokens to collect
    // the dot-separated qualified name parts before the cursor.
    // Pattern: IDENTIFIER DOT IDENTIFIER DOT ... (right to left)
    const completedParts: string[] = [];
    let i = onChannelTokens.length - 1;

    // If last token is an IDENTIFIER matching prefix, skip it (it's what the user is typing)
    if (i >= 0 &&
        onChannelTokens[i].type === SqlBaseLexer.IDENTIFIER &&
        onChannelTokens[i].text?.toUpperCase() === prefix && prefix.length > 0) {
      i--;
    }

    // Now collect DOT IDENTIFIER pairs going backwards
    while (i >= 1) {
      if (onChannelTokens[i].type === DOT_TOKEN &&
          (onChannelTokens[i - 1].type === SqlBaseLexer.IDENTIFIER ||
           keywordMap.has(onChannelTokens[i - 1].type))) {
        completedParts.unshift(onChannelTokens[i - 1].text ?? '');
        i -= 2;
      } else {
        break;
      }
    }

    // Also check if last token IS a dot (user just typed "catalog.")
    // In that case the prefix is empty and we need to check if the token
    // right before our walk is a dot
    const lastOnChannel = onChannelTokens[onChannelTokens.length - 1];
    if (lastOnChannel?.type === DOT_TOKEN && prefix.length === 0) {
      // The dot is consumed; collect IDENTIFIER before it
      let j = onChannelTokens.length - 2;
      completedParts.length = 0; // reset
      while (j >= 0) {
        if (onChannelTokens[j].type === SqlBaseLexer.IDENTIFIER ||
            keywordMap.has(onChannelTokens[j].type)) {
          completedParts.unshift(onChannelTokens[j].text ?? '');
          j--;
          if (j >= 0 && onChannelTokens[j].type === DOT_TOKEN) {
            j--;
          } else {
            break;
          }
        } else {
          break;
        }
      }
    }

    const mp = this.metadataProvider;
    const suggestions: monaco.languages.CompletionItem[] = [];

    const filterPrefix = prefix.toLowerCase();
    const matches = (name: string) =>
      filterPrefix.length === 0 || name.toLowerCase().startsWith(filterPrefix);

    // A dotted part is only asked about if a list already holds it. Most of
    // what precedes a dot in SQL is a table alias, and `t.` used to send
    // `SHOW SCHEMAS FROM "t"` to the cluster on every keystroke — a query
    // that fails there and is recorded as a failure here. Unquoted names are
    // lowercased by Trino, so `TPCH.` still finds `tpch`.
    const known = (names: string[], name: string) =>
      names.includes(name) || names.includes(name.toLowerCase());

    try {
      if (completedParts.length === 0) {
        // No dots: suggest tables from default catalog.schema + schemas from default catalog + all catalogs
        const [defaultCatalog, defaultSchema, catalogs] = await Promise.all([
          mp.getDefaultCatalog(),
          mp.getDefaultSchema(),
          mp.getCatalogs(),
        ]);

        if (defaultCatalog && defaultSchema) {
          const tables = await mp.getTables(defaultCatalog, defaultSchema);
          for (const table of tables) {
            if (!matches(table)) continue;
            suggestions.push(makeSuggestion(table, monaco.languages.CompletionItemKind.Field, wordRange, {
              detail: `${defaultCatalog}.${defaultSchema}`,
            }));
          }
        }

        if (defaultCatalog) {
          const schemas = await mp.getSchemas(defaultCatalog);
          for (const schema of schemas) {
            if (!matches(schema)) continue;
            suggestions.push(makeSuggestion(schema, monaco.languages.CompletionItemKind.Struct, wordRange, {
              detail: defaultCatalog,
              insertText: schema + '.',
              command: RETRIGGER_COMMAND,
            }));
          }
        }

        for (const catalog of catalogs) {
          if (!matches(catalog)) continue;
          suggestions.push(makeSuggestion(catalog, monaco.languages.CompletionItemKind.Module, wordRange, {
            insertText: catalog + '.',
            command: RETRIGGER_COMMAND,
          }));
        }
      } else if (completedParts.length === 1) {
        // One part before dot: could be catalog or schema
        const part = completedParts[0];

        // Try as catalog → suggest schemas
        if (known(await mp.getCatalogs(), part)) {
          const schemasFromCatalog = await mp.getSchemas(part);
          for (const schema of schemasFromCatalog) {
            if (!matches(schema)) continue;
            suggestions.push(makeSuggestion(schema, monaco.languages.CompletionItemKind.Struct, wordRange, {
              detail: part,
              insertText: schema + '.',
              command: RETRIGGER_COMMAND,
            }));
          }
        }

        // Try as schema in default catalog → suggest tables
        const defaultCatalog = await mp.getDefaultCatalog();
        if (defaultCatalog && known(await mp.getSchemas(defaultCatalog), part)) {
          const tablesFromSchema = await mp.getTables(defaultCatalog, part);
          for (const table of tablesFromSchema) {
            if (!matches(table)) continue;
            suggestions.push(makeSuggestion(table, monaco.languages.CompletionItemKind.Field, wordRange, {
              detail: `${defaultCatalog}.${part}`,
            }));
          }
        }
      } else if (completedParts.length === 2) {
        // Two parts: catalog.schema → suggest tables
        const [catalog, schema] = completedParts;
        if (known(await mp.getCatalogs(), catalog) && known(await mp.getSchemas(catalog), schema)) {
          const tables = await mp.getTables(catalog, schema);
          for (const table of tables) {
            if (!matches(table)) continue;
            suggestions.push(makeSuggestion(table, monaco.languages.CompletionItemKind.Field, wordRange, {
              detail: `${catalog}.${schema}`,
            }));
          }
        }
      }
    } catch (e) {
      console.error('Metadata completion failed:', e);
    }

    return suggestions;
  }
}
