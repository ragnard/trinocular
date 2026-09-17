import { qualifiedName, quoteIdentifier } from "monaco-language-trino";
import type { ColumnInfo } from "$lib/catalog/CatalogCache.svelte";

export interface TableRef {
  catalog: string;
  schema: string;
  table: string;
}

/**
 * A SELECT naming every column, one per line, so the list is there to be cut
 * down. A table whose columns are unknown gets `*`, which at least runs.
 */
export function selectStatement(ref: TableRef, columns: readonly ColumnInfo[]): string {
  const from = `FROM\n  ${qualifiedName(ref.catalog, ref.schema, ref.table)};`;
  if (columns.length === 0) return `SELECT *\n${from}`;
  const list = columns.map((column) => `  ${quoteIdentifier(column.name)}`).join(",\n");
  return `SELECT\n${list}\n${from}`;
}

/** `sql` as a complete statement: Trino's own DDL comes back without the `;`. */
export function terminated(sql: string): string {
  return sql.trimEnd().endsWith(";") ? sql : `${sql};`;
}
