import * as monaco from "monaco-editor";
import { SqlBaseParser } from "../parser/SqlBaseParser";
import { keywordMap } from "./trinoKeywordMap";
import { collectContext, dottedParts, functionKindsAt } from "./completionContext";
import type { FunctionInfo, FunctionKind, MetadataProvider } from "./metadataProvider";
import type { DocumentParseService } from "./documentParseService";

// Built-in Trino type names. These are parsed as identifiers (not keywords)
// via GenericTypeContext, so they won't appear in c3's token candidates.
// Suggested when the grammar expects an identifier.
const TRINO_TYPES = [
  "BIGINT",
  "BOOLEAN",
  "CHAR",
  "DATE",
  "DECIMAL",
  "DOUBLE",
  "INTEGER",
  "INT",
  "IPADDRESS",
  "JSON",
  "REAL",
  "SMALLINT",
  "TINYINT",
  "UUID",
  "VARBINARY",
  "VARCHAR"
];

const RETRIGGER_COMMAND: monaco.languages.Command = {
  id: "editor.action.triggerSuggest",
  title: "Re-trigger"
};

function makeSuggestion(
  label: string,
  kind: monaco.languages.CompletionItemKind,
  range: monaco.IRange,
  options?: {
    detail?: string;
    documentation?: string;
    insertText?: string;
    insertTextRules?: monaco.languages.CompletionItemInsertTextRule;
    command?: monaco.languages.Command;
  }
): monaco.languages.CompletionItem {
  return {
    label,
    kind,
    insertText: options?.insertText ?? label,
    range,
    ...(options?.detail && { detail: options.detail }),
    ...(options?.documentation && { documentation: options.documentation }),
    ...(options?.insertTextRules && { insertTextRules: options.insertTextRules }),
    ...(options?.command && { command: options.command })
  };
}

/**
 * What monaco shows beside the name. Overloads are folded into a count rather
 * than listed, since `abs` has seven and a menu row has one line; the kind is
 * written only when it is not `scalar`, because an aggregate is the thing worth
 * warning of — it will want a `GROUP BY` — and a scalar is what everybody
 * already assumes.
 */
function functionDetail(fn: FunctionInfo): string {
  const shape = fn.signatures.length === 1 ? fn.signatures[0] : `${fn.signatures.length} overloads`;
  return fn.kind === "scalar" ? shape : `${fn.kind} · ${shape}`;
}

/**
 * A dotted part is only asked about if a list already holds it. Most of what
 * precedes a dot in SQL is a table alias, and `t.` used to send
 * `SHOW SCHEMAS FROM "t"` to the cluster on every keystroke — a query that
 * fails there and is recorded as a failure here. Unquoted names are lowercased
 * by Trino, so `TPCH.` still finds `tpch`.
 */
function known(names: string[], name: string): boolean {
  return names.includes(name) || names.includes(name.toLowerCase());
}

export class TrinoCompletionProvider implements monaco.languages.CompletionItemProvider {
  triggerCharacters = ["."];

  constructor(
    private readonly metadataProvider: MetadataProvider,
    private readonly parseService: DocumentParseService
  ) {}

  async provideCompletionItems(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    _context: monaco.languages.CompletionContext,
    token: monaco.CancellationToken
  ): Promise<monaco.languages.CompletionList> {
    const fullText = model.getValue();
    const cursorOffset = model.getOffsetAt(position);

    // Use cached statement splits from the parse service
    const statements = this.parseService.getStatements(model);
    const currentStmt = statements.find(
      (s) => cursorOffset >= s.startOffset && cursorOffset <= s.endOffset
    );
    const statementText = currentStmt
      ? fullText.substring(currentStmt.startOffset, cursorOffset)
      : fullText.substring(0, cursorOffset);

    // Get prefix using Monaco's word detection
    const wordInfo = model.getWordUntilPosition(position);
    const prefix = wordInfo.word.toUpperCase();

    const { candidates, onChannelTokens } = collectContext(statementText, prefix);

    // Convert candidates to completion items
    const wordRange = new monaco.Range(
      position.lineNumber,
      wordInfo.startColumn,
      position.lineNumber,
      wordInfo.endColumn
    );

    const suggestions: monaco.languages.CompletionItem[] = [];
    for (const [tokenType] of candidates.tokens) {
      const keyword = keywordMap.get(tokenType);
      if (!keyword) continue;
      if (prefix.length > 0 && !keyword.startsWith(prefix)) continue;
      suggestions.push(
        makeSuggestion(keyword, monaco.languages.CompletionItemKind.Keyword, wordRange)
      );
    }

    // When the grammar expects an identifier, suggest built-in type names.
    if (candidates.rules.has(SqlBaseParser.RULE_identifier)) {
      for (const typeName of TRINO_TYPES) {
        if (prefix.length > 0 && !typeName.startsWith(prefix)) continue;
        suggestions.push(
          makeSuggestion(typeName, monaco.languages.CompletionItemKind.TypeParameter, wordRange)
        );
      }
    }

    // Dynamic metadata completions when grammar expects a name
    if (
      candidates.rules.has(SqlBaseParser.RULE_qualifiedName) ||
      candidates.rules.has(SqlBaseParser.RULE_identifier)
    ) {
      const parts = dottedParts(onChannelTokens, prefix);
      const kinds = functionKindsAt(candidates);
      const [metaSuggestions, fnSuggestions] = await Promise.all([
        this.getMetadataCompletions(parts, prefix, wordRange),
        kinds ? this.getFunctionCompletions(parts, kinds, prefix, wordRange) : []
      ]);
      suggestions.push(...metaSuggestions, ...fnSuggestions);
    }

    return { suggestions };
  }

  /**
   * The functions that can be called where the caret is. Only two shapes are
   * asked about: a bare name, which the cluster resolves against the built-ins
   * and the session path, and a fully qualified `catalog.schema.name`, which is
   * where a connector's own functions live.
   *
   * A single part before the dot is never asked about. In an expression it is
   * nearly always a table alias, and `SHOW FUNCTIONS FROM t` is not even the
   * question it looks like — Trino reads one part as a *schema* in the session
   * catalog and fails with `MISSING_CATALOG_NAME` when there is none.
   *
   * With two parts the catalog is checked against the list and **the schema
   * deliberately is not**. A connector keeps its table functions in a `system`
   * schema that `SHOW SCHEMAS` does not list — `keycloak_pg.system.query` is
   * real while `SHOW SCHEMAS FROM keycloak_pg` says only `information_schema`,
   * `pg_catalog` and `public` — so a schema guard would refuse to complete
   * precisely the functions worth completing. A wrong guess is cheap and quiet
   * where `SHOW SCHEMAS FROM "t"` was neither: it is answered empty in about
   * 60ms, cached, and never recorded as a failure.
   */
  private async getFunctionCompletions(
    parts: string[],
    kinds: ReadonlySet<FunctionKind>,
    prefix: string,
    wordRange: monaco.IRange
  ): Promise<monaco.languages.CompletionItem[]> {
    const mp = this.metadataProvider;
    const filterPrefix = prefix.toLowerCase();

    try {
      let functions: FunctionInfo[];
      if (parts.length === 0) {
        functions = await mp.getFunctions();
      } else if (parts.length === 2) {
        const [catalog, schema] = parts;
        if (!known(await mp.getCatalogs(), catalog)) return [];
        functions = await mp.getSchemaFunctions(catalog, schema);
      } else {
        return [];
      }

      return functions
        .filter((fn) => kinds.has(fn.kind))
        .filter((fn) => fn.name.toLowerCase().startsWith(filterPrefix))
        .map((fn) =>
          makeSuggestion(fn.name, monaco.languages.CompletionItemKind.Function, wordRange, {
            detail: functionDetail(fn),
            documentation: fn.description,
            // The caret lands between the parentheses, which is where the next
            // thing to type goes. `$0` and not `$1`, so nothing is left holding
            // a snippet session open over a single stop.
            insertText: `${fn.name}($0)`,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
          })
        );
    } catch (e) {
      console.error("Function completion failed:", e);
      return [];
    }
  }

  /**
   * Suggest catalogs/schemas/tables from how many dot-separated parts have
   * already been typed. A dotted name is a relation in `FROM` and a column
   * reference in an expression — Trino accepts `catalog.schema.table.column`
   * there — so the same three levels are worth offering in both.
   */
  private async getMetadataCompletions(
    completedParts: string[],
    prefix: string,
    wordRange: monaco.IRange
  ): Promise<monaco.languages.CompletionItem[]> {
    const mp = this.metadataProvider;
    const suggestions: monaco.languages.CompletionItem[] = [];

    const filterPrefix = prefix.toLowerCase();
    const matches = (name: string) =>
      filterPrefix.length === 0 || name.toLowerCase().startsWith(filterPrefix);

    try {
      if (completedParts.length === 0) {
        // No dots: suggest tables from default catalog.schema + schemas from default catalog + all catalogs
        const [defaultCatalog, defaultSchema, catalogs] = await Promise.all([
          mp.getDefaultCatalog(),
          mp.getDefaultSchema(),
          mp.getCatalogs()
        ]);

        if (defaultCatalog && defaultSchema) {
          const tables = await mp.getTables(defaultCatalog, defaultSchema);
          for (const table of tables) {
            if (!matches(table)) continue;
            suggestions.push(
              makeSuggestion(table, monaco.languages.CompletionItemKind.Field, wordRange, {
                detail: `${defaultCatalog}.${defaultSchema}`
              })
            );
          }
        }

        if (defaultCatalog) {
          const schemas = await mp.getSchemas(defaultCatalog);
          for (const schema of schemas) {
            if (!matches(schema)) continue;
            suggestions.push(
              makeSuggestion(schema, monaco.languages.CompletionItemKind.Struct, wordRange, {
                detail: defaultCatalog,
                insertText: schema + ".",
                command: RETRIGGER_COMMAND
              })
            );
          }
        }

        for (const catalog of catalogs) {
          if (!matches(catalog)) continue;
          suggestions.push(
            makeSuggestion(catalog, monaco.languages.CompletionItemKind.Module, wordRange, {
              insertText: catalog + ".",
              command: RETRIGGER_COMMAND
            })
          );
        }
      } else if (completedParts.length === 1) {
        // One part before dot: could be catalog or schema
        const part = completedParts[0];

        // Try as catalog → suggest schemas
        if (known(await mp.getCatalogs(), part)) {
          const schemasFromCatalog = await mp.getSchemas(part);
          for (const schema of schemasFromCatalog) {
            if (!matches(schema)) continue;
            suggestions.push(
              makeSuggestion(schema, monaco.languages.CompletionItemKind.Struct, wordRange, {
                detail: part,
                insertText: schema + ".",
                command: RETRIGGER_COMMAND
              })
            );
          }
        }

        // Try as schema in default catalog → suggest tables
        const defaultCatalog = await mp.getDefaultCatalog();
        if (defaultCatalog && known(await mp.getSchemas(defaultCatalog), part)) {
          const tablesFromSchema = await mp.getTables(defaultCatalog, part);
          for (const table of tablesFromSchema) {
            if (!matches(table)) continue;
            suggestions.push(
              makeSuggestion(table, monaco.languages.CompletionItemKind.Field, wordRange, {
                detail: `${defaultCatalog}.${part}`
              })
            );
          }
        }
      } else if (completedParts.length === 2) {
        // Two parts: catalog.schema → suggest tables
        const [catalog, schema] = completedParts;
        if (known(await mp.getCatalogs(), catalog) && known(await mp.getSchemas(catalog), schema)) {
          const tables = await mp.getTables(catalog, schema);
          for (const table of tables) {
            if (!matches(table)) continue;
            suggestions.push(
              makeSuggestion(table, monaco.languages.CompletionItemKind.Field, wordRange, {
                detail: `${catalog}.${schema}`
              })
            );
          }
        }
      }
    } catch (e) {
      console.error("Metadata completion failed:", e);
    }

    return suggestions;
  }
}
