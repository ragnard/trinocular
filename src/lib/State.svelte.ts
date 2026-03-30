import Trino  from "$lib/trino";
import type { Columns, QueryData, QueryError, QueryResult, QueryStats } from "$lib/trino";

export class Workspace {
  queries: Array<Query> = $state([])

  latestQuery: Query | null = $state.raw(null); // $derived(this.queries && this.queries[this.queries.length-1]);
  // activeQuery: Query | null = $state.raw(null);

  async executeQuery(client: Trino, sql: string) {
    const query = new Query(client, sql);
    this.queries.push(query);
    this.latestQuery = query;
    query.execute();
  }

  setLatestQuery(query: Query) {
    this.latestQuery = query;
  }

}

export type State = "RUNNING" | "FINISHED" | "ERROR";

export class Query {
  client: Trino
  id: string = $state("");
  sql: string = $state("");
  results: QueryResult[] = $state([]);

  latestResult?: QueryResult = $derived(this.results && this.results[this.results.length - 1]);
  latestStats?: QueryStats = $derived(this.latestResult?.stats);
  queryState?: State = $derived(this.latestStats?.state as State);
  schema?: Columns = $derived(this.results.find((r) => r.columns)?.columns);
  data?: QueryData[] = $derived(this.results.filter((r) => r.data).flatMap((r) => r.data ?? []));
  infoUri?: string = $derived(this.results.find((r) => r.infoUri)?.infoUri);
  error?: QueryError = $derived(this.results.find((r) => r.error)?.error);

  elapsedTimeSeconds = $derived.by(() => {
    const elapsedMillis = this.latestStats?.elapsedTimeMillis;
    if (elapsedMillis) {
      return (elapsedMillis / 1000).toFixed(1);
    } else {
      return 0;
    }
  });

  constructor(client: Trino, sql: string = "") {
    this.client = client;
    this.id = crypto.randomUUID();
    this.sql = sql;
  }

  async execute() {
    const res = await this.client.query(this.sql);

    for await (const chunk of res) {
      this.results.push(chunk);
    }
  }

  async cancel() {
    // TODO
    // this.client.cancel(this.queryId))
  }

}
