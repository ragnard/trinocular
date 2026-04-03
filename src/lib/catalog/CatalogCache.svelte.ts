import type Trino from "$lib/trino";
import type { QueryResult } from "$lib/trino";

export type ColumnInfo = { name: string; type: string };

async function collectColumn(
  client: Trino,
  sql: string,
  column: number
): Promise<string[]> {
  const iter = await client.query(sql);
  const result: string[] = [];
  for await (const chunk of iter) {
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
    if (chunk.data) {
      result.push(...chunk.data);
    }
  }
  return result;
}

export class CatalogCache {
  #client: Trino;

  catalogs: string[] = $state.raw([]);
  #schemas: Map<string, string[]> = $state.raw(new Map());
  #tables: Map<string, string[]> = $state.raw(new Map());
  #columns: Map<string, ColumnInfo[]> = $state.raw(new Map());

  #inflight = new Map<string, Promise<any>>();
  loading: Set<string> = $state.raw(new Set());

  constructor(client: Trino) {
    this.#client = client;
  }

  #dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.#inflight.get(key);
    if (existing) return existing;
    this.loading = new Set(this.loading).add(key);
    const promise = fn().finally(() => {
      this.#inflight.delete(key);
      const next = new Set(this.loading);
      next.delete(key);
      this.loading = next;
    });
    this.#inflight.set(key, promise);
    return promise;
  }

  async loadCatalogs(): Promise<string[]> {
    if (this.catalogs.length > 0) return this.catalogs;
    return this.#dedupe("catalogs", async () => {
      const rows = await collectColumn(this.#client, "SHOW CATALOGS", 0);
      this.catalogs = rows;
      return rows;
    });
  }

  async loadSchemas(catalog: string): Promise<string[]> {
    const cached = this.#schemas.get(catalog);
    if (cached) return cached;
    return this.#dedupe(`schemas:${catalog}`, async () => {
      const rows = await collectColumn(
        this.#client,
        `SHOW SCHEMAS FROM "${catalog}"`,
        0
      );
      this.#schemas = new Map(this.#schemas).set(catalog, rows);
      return rows;
    });
  }

  async loadTables(catalog: string, schema: string): Promise<string[]> {
    const key = `${catalog}.${schema}`;
    const cached = this.#tables.get(key);
    if (cached) return cached;
    return this.#dedupe(`tables:${key}`, async () => {
      const rows = await collectColumn(
        this.#client,
        `SHOW TABLES FROM "${catalog}"."${schema}"`,
        0
      );
      this.#tables = new Map(this.#tables).set(key, rows);
      return rows;
    });
  }

  async loadColumns(
    catalog: string,
    schema: string,
    table: string
  ): Promise<ColumnInfo[]> {
    const key = `${catalog}.${schema}.${table}`;
    const cached = this.#columns.get(key);
    if (cached) return cached;
    return this.#dedupe(`columns:${key}`, async () => {
      const rows = await collectRows(
        this.#client,
        `SHOW COLUMNS FROM "${catalog}"."${schema}"."${table}"`
      );
      const columns = rows.map((row) => ({ name: row[0], type: row[1] }));
      this.#columns = new Map(this.#columns).set(key, columns);
      return columns;
    });
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
