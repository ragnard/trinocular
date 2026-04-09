import Trino, { HttpError } from "$lib/trino";
import type { Columns, QueryData, QueryError, QueryResult, QueryStats } from "$lib/trino";
import { CatalogCache } from "$lib/catalog/CatalogCache.svelte";

export class Workspace {
  id: string;
  #queryId: number = 1;
  queries: Array<Query> = $state([])

  activeQuery: Query | null = $state.raw(null);

  connectionId: string = $state("");
  client: Trino = $state.raw(null!);
  catalog: CatalogCache = $state.raw(null!);

  constructor(connectionId: string, id: string = "default") {
    this.id = id;
    this.connectionId = connectionId;
    this.client = this.#createClient(connectionId);
    this.catalog = new CatalogCache(this.client);
  }

  #createClient(connectionId: string): Trino {
    return Trino.create({ server: `/api/trino/${connectionId}` });
  }

  setConnection(connectionId: string) {
    this.connectionId = connectionId;
    this.client = this.#createClient(connectionId);
    this.catalog = new CatalogCache(this.client);
  }

  async executeQuery(sql: string) {
    const query = new Query(this.client, this.#queryId++, sql);
    this.queries.unshift(query);
    if (this.queries.length > 10) {
      this.queries.pop();
    }
    this.activeQuery = query;
    await query.execute();
  }

  setActiveQuery(query: Query) {
    this.activeQuery = query;
  }

  removeQuery(query: Query) {
    if (query == this.activeQuery) {
      this.activeQuery = null;
    }

    const index = this.queries.indexOf(query);
    if (index !== -1) {
      this.queries.splice(index, 1);
    }
  }

}

export type State = "PLANNING" | "QUEUED" | "RUNNING" | "FINISHED" | "FAILED";

const COMPLETED_STATES: Set<State> = new Set(["FINISHED", "FAILED"]);

export class Query {
  client: Trino
  id: number;
  sql: string;

  queryId?: string = $state();
  infoUri?: string = $state();
  columns?: Columns = $state.raw();
  data?: QueryData[] = $state.raw();
  stats?: QueryStats = $state.raw();
  warnings?: string[] = $state.raw();
  error?: QueryError = $state.raw();

  constructor(client: Trino, id: number, sql: string = "") {
    this.client = client;
    this.id = id;
    this.sql = sql;
  }

  queryState?: State = $derived(this.stats?.state as State);
  schema?: Columns = $derived(this.columns);
  completed?: boolean = $derived(this.error != null || (this.queryState && COMPLETED_STATES.has(this.queryState)))
  running?: boolean = $derived(!this.completed);
  rowCount?: number = $derived(this.data?.length);

  elapsedTimeSeconds = $derived.by(() => {
    const elapsedMillis = this.stats?.elapsedTimeMillis;
    if (elapsedMillis) {
      return (elapsedMillis / 1000).toFixed(1);
    } else {
      return 0;
    }
  });


  async execute() {
    try {
      const res = await this.client.query(this.sql);

      for await (const chunk of res) {
        if (chunk.id) this.queryId = chunk.id;
        if (chunk.infoUri) this.infoUri = chunk.infoUri;
        if (chunk.columns) this.columns = chunk.columns;
        if (chunk.stats) this.stats = chunk.stats;
        if (chunk.warnings) this.warnings = chunk.warnings;
        if (chunk.error) this.error = chunk.error;

        if (chunk.data) {
          this.data = this.data ? this.data.concat(chunk.data) : chunk.data;
        }
      }
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        window.location.href = "/auth/login";
        return;
      }
      const message = e instanceof Error ? e.message : String(e);
      this.error = {
        message,
        errorCode: 0,
        errorName: "CLIENT_ERROR",
        errorType: "CLIENT_ERROR",
        failureInfo: { type: "ClientError", message, suppressed: [], stack: [] },
      };
    }
  }

  async cancel() {
    if (this.queryId) {
      await this.client.cancel(this.queryId)
    }
  }

}
