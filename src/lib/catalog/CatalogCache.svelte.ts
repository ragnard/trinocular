import type Trino from "$lib/trino";
import type { QueryError } from "$lib/trino";
import { qualifiedName } from "monaco-language-trino";

export type ColumnInfo = { name: string; type: string };

/**
 * The client does not throw on a failed query — the failure arrives as `error`
 * on the last chunk — so a collector that only reads `data` sees an empty list.
 */
export class CatalogQueryError extends Error {
  error: QueryError;
  constructor(error: QueryError) {
    super(error.message);
    this.name = "CatalogQueryError";
    this.error = error;
  }
}

async function collectColumn(
  client: Trino,
  sql: string,
  column: number
): Promise<string[]> {
  const iter = await client.query(sql);
  const result: string[] = [];
  for await (const chunk of iter) {
    if (chunk.error) throw new CatalogQueryError(chunk.error);
    if (chunk.data) {
      for (const row of chunk.data) {
        result.push(row[column]);
      }
    }
  }
  return result;
}

async function collectRows(
  client: Trino,
  sql: string
): Promise<any[][]> {
  const iter = await client.query(sql);
  const result: any[][] = [];
  for await (const chunk of iter) {
    if (chunk.error) throw new CatalogQueryError(chunk.error);
    if (chunk.data) {
      result.push(...chunk.data);
    }
  }
  return result;
}

function first(rows: string[]): string {
  if (rows.length === 0) throw new Error("The cluster returned nothing.");
  return rows[0];
}

function without<K, V>(map: Map<K, V>, key: K): Map<K, V> {
  const next = new Map(map);
  next.delete(key);
  return next;
}

export class CatalogCache {
  #client: Trino;

  catalogs: string[] = $state.raw([]);
  #schemas: Map<string, string[]> = $state.raw(new Map());
  #tables: Map<string, string[]> = $state.raw(new Map());
  #columns: Map<string, ColumnInfo[]> = $state.raw(new Map());

  #inflight = new Map<string, Promise<any>>();
  loading: Set<string> = $state.raw(new Set());
  errors: Map<string, string> = $state.raw(new Map());

  constructor(client: Trino) {
    this.#client = client;
  }

  /**
   * `invalidate` drops the list a failed fetch was replacing: a reload that
   * fails leaves the error under the node rather than under rows that say
   * the opposite.
   */
  #dedupe<T>(key: string, fn: () => Promise<T>, invalidate: () => void): Promise<T> {
    const existing = this.#inflight.get(key);
    if (existing) return existing;
    this.loading = new Set(this.loading).add(key);
    if (this.errors.has(key)) this.errors = without(this.errors, key);
    const promise = fn()
      .catch((e) => {
        invalidate();
        this.errors = new Map(this.errors).set(key, e instanceof Error ? e.message : String(e));
        throw e;
      })
      .finally(() => {
        this.#inflight.delete(key);
        const next = new Set(this.loading);
        next.delete(key);
        this.loading = next;
      });
    this.#inflight.set(key, promise);
    return promise;
  }

  async loadCatalogs(fresh = false): Promise<string[]> {
    if (this.catalogs.length > 0 && !fresh) return this.catalogs;
    return this.#dedupe(
      "catalogs",
      async () => {
        const rows = await collectColumn(this.#client, "SHOW CATALOGS", 0);
        this.catalogs = rows;
        return rows;
      },
      () => (this.catalogs = [])
    );
  }

  async loadSchemas(catalog: string, fresh = false): Promise<string[]> {
    const cached = this.#schemas.get(catalog);
    if (cached && !fresh) return cached;
    return this.#dedupe(
      `schemas:${catalog}`,
      async () => {
        const rows = await collectColumn(this.#client, `SHOW SCHEMAS FROM ${qualifiedName(catalog)}`, 0);
        this.#schemas = new Map(this.#schemas).set(catalog, rows);
        return rows;
      },
      () => (this.#schemas = without(this.#schemas, catalog))
    );
  }

  async loadTables(catalog: string, schema: string, fresh = false): Promise<string[]> {
    const key = `${catalog}.${schema}`;
    const cached = this.#tables.get(key);
    if (cached && !fresh) return cached;
    return this.#dedupe(
      `tables:${key}`,
      async () => {
        const rows = await collectColumn(
          this.#client,
          `SHOW TABLES FROM ${qualifiedName(catalog, schema)}`,
          0
        );
        this.#tables = new Map(this.#tables).set(key, rows);
        return rows;
      },
      () => (this.#tables = without(this.#tables, key))
    );
  }

  async loadColumns(
    catalog: string,
    schema: string,
    table: string,
    fresh = false
  ): Promise<ColumnInfo[]> {
    const key = `${catalog}.${schema}.${table}`;
    const cached = this.#columns.get(key);
    if (cached && !fresh) return cached;
    return this.#dedupe(
      `columns:${key}`,
      async () => {
        const rows = await collectRows(
          this.#client,
          `SHOW COLUMNS FROM ${qualifiedName(catalog, schema, table)}`
        );
        const columns = rows.map((row) => ({ name: row[0], type: row[1] }));
        this.#columns = new Map(this.#columns).set(key, columns);
        return columns;
      },
      () => (this.#columns = without(this.#columns, key))
    );
  }

  /**
   * The DDL Trino itself writes for the table, uncached: it is one click and
   * one query, and a stale copy would have no reload to clear it. `SHOW TABLES`
   * lists views too, and `SHOW CREATE TABLE` refuses those saying which kind
   * of relation it met, so the refusal is what picks the statement that does
   * answer. The name is quoted only where it has to be, because a view's DDL
   * comes back naming the view the way it was asked for.
   */
  async showCreate(catalog: string, schema: string, table: string): Promise<string> {
    const name = qualifiedName(catalog, schema, table);
    try {
      return await collectColumn(this.#client, `SHOW CREATE TABLE ${name}`, 0).then(first);
    } catch (e) {
      const kind =
        e instanceof CatalogQueryError &&
        /is an? (materialized view|view), not a table/i.exec(e.message)?.[1];
      if (!kind) throw e;
      const statement = `SHOW CREATE ${kind.toUpperCase()} ${name}`;
      return collectColumn(this.#client, statement, 0).then(first);
    }
  }

  getSchemas(catalog: string): string[] {
    return this.#schemas.get(catalog) ?? [];
  }

  getTables(catalog: string, schema: string): string[] {
    return this.#tables.get(`${catalog}.${schema}`) ?? [];
  }

  getColumns(catalog: string, schema: string, table: string): ColumnInfo[] {
    return this.#columns.get(`${catalog}.${schema}.${table}`) ?? [];
  }
}
