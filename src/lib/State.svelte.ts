import Trino  from "$lib/trino";
import type { Columns, QueryData, QueryError, QueryResult, QueryStats } from "$lib/trino";

export class Workspace {
  #id: number = 1;
  queries: Array<Query> = $state([])

  activeQuery: Query | null = $state.raw(null);

  async executeQuery(client: Trino, sql: string) {
    const query = new Query(client, this.#id++, sql);
    this.queries.push(query);
    this.activeQuery = query;
    query.execute();
  }

  setActiveQuery(query: Query) {
    this.activeQuery = query;
  }

  removeQuery(query: Query) {
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
  sql: string = $state("");
  results: QueryResult[] = $state([]);


  constructor(client: Trino, id: number, sql: string = "") {
    this.client = client;
    this.id = id;
    this.sql = sql;
  }

  queryId?: string = $derived(this.latestResult?.id);
  latestResult?: QueryResult = $derived(this.results && this.results[this.results.length - 1]);
  latestStats?: QueryStats = $derived(this.latestResult?.stats);
  queryState?: State = $derived(this.latestStats?.state as State);
  schema?: Columns = $derived(this.results.find((r) => r.columns)?.columns);
  data?: QueryData[] = $derived(this.results.filter((r) => r.data).flatMap((r) => r.data ?? []));
  infoUri?: string = $derived(this.results.find((r) => r.infoUri)?.infoUri);
  error?: QueryError = $derived(this.results.find((r) => r.error)?.error);
  completed?: boolean = $derived(this.queryState && COMPLETED_STATES.has(this.queryState))
  running?: boolean = $derived(!this.completed);
  rowCount?: number = $derived(this.data?.length);

  elapsedTimeSeconds = $derived.by(() => {
    const elapsedMillis = this.latestStats?.elapsedTimeMillis;
    if (elapsedMillis) {
      return (elapsedMillis / 1000).toFixed(1);
    } else {
      return 0;
    }
  });


  async execute() {
    const res = await this.client.query(this.sql);

    for await (const chunk of res) {
      this.results.push(chunk);
    }
  }

  async cancel() {
    if (this.queryId) {
      await this.client.cancel(this.queryId)
    }
  }

}
