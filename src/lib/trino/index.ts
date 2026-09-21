/*
 * Copyright 2026 Ragnar Dahlén
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Derived from trino-js-client, https://github.com/trinodb/trino-js-client,
 * also licensed under the Apache License, Version 2.0. This file has been
 * modified: authentication, the X-Trino-User header, extra credentials and
 * TLS options were removed, because the browser talks only to this app's
 * own proxy, which attaches identity itself.
 */

import {
  EMPTY_SESSION,
  applyDelta,
  sessionDelta,
  sessionHeaders,
  type SessionDelta,
  type SessionState
} from "./session";

export type { SessionDelta, SessionState } from "./session";

/**
 * An answer that was not a 2xx. The message is what the body had to say, when
 * it was JSON with a `message` (SvelteKit's `error()` body, which is how the
 * proxy reports an unknown connection, a bad path or a cluster it could not
 * reach) or an `error` (the access gate's `refuse()` body), with the status
 * after it; a body with nothing to say leaves just the status. Without this a
 * dead cluster read as `HTTP error 502: Bad Gateway`, which says nothing about
 * whether the cluster, the proxy or the user's access is what failed — and
 * under HTTP/2 `statusText` is empty, so it read `HTTP error 502:`. `status`
 * stays a field so a 401 can still be told apart.
 */
export class HttpError extends Error {
  status: number;
  constructor(status: number, statusText: string, detail?: string) {
    const code = statusText ? `HTTP ${status} ${statusText}` : `HTTP ${status}`;
    super(detail ? `${detail} (${code})` : code);
    this.name = "HttpError";
    this.status = status;
  }

  /** Builds one from an answer, reading its body for the message. */
  static async from(response: Response): Promise<HttpError> {
    return new HttpError(response.status, response.statusText, await errorDetail(response));
  }
}

/** The `message` or `error` string of a JSON error body, if the body is one. */
async function errorDetail(response: Response): Promise<string | undefined> {
  let body: unknown;
  try {
    body = JSON.parse(await response.text());
  } catch {
    return undefined;
  }
  if (typeof body !== "object" || body === null) return undefined;
  for (const key of ["message", "error"]) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

const DEFAULT_SOURCE = "trinocular";

// Trino headers
const TRINO_HEADER_PREFIX = "X-Trino-";

export const isTrinoHeader = (name: string): boolean =>
  name.toLowerCase().startsWith(TRINO_HEADER_PREFIX.toLowerCase());
const TRINO_SOURCE_HEADER = TRINO_HEADER_PREFIX + "Source";

export type RequestHeaders = {
  [key: string]: string;
};

export type ConnectionOptions = {
  /** Always this app's own proxy: `/api/trino/<connectionId>`. */
  readonly server: string;
  readonly source?: string;
  /** The session the first request starts from. Absent is an empty one. */
  readonly session?: SessionState;
  /**
   * Told what each response changed in the session — `USE`, `SET SESSION`,
   * `PREPARE` — so that whoever hands out clients can carry it to the next
   * one. The client has already folded the delta into its own state.
   */
  readonly onSessionChange?: (delta: SessionDelta) => void;
  readonly extraHeaders?: RequestHeaders;
};

export type QueryStage = {
  stageId: string;
  state: string;
  done: boolean;
  nodes: number;
  totalSplits: number;
  queuedSplits: number;
  runningSplits: number;
  completedSplits: number;
  cpuTimeMillis: number;
  wallTimeMillis: number;
  processedRows: number;
  processedBytes: number;
  physicalInputBytes: number;
  failedTasks: number;
  coordinatorOnly: boolean;
  subStages: QueryStage[];
};

export type QueryStats = {
  state: string;
  queued: boolean;
  scheduled: boolean;
  nodes: number;
  totalSplits: number;
  queuedSplits: number;
  runningSplits: number;
  completedSplits: number;
  cpuTimeMillis: number;
  wallTimeMillis: number;
  queuedTimeMillis: number;
  elapsedTimeMillis: number;
  processedRows: number;
  processedBytes: number;
  physicalInputBytes: number;
  peakMemoryBytes: number;
  spilledBytes: number;
  rootStage: QueryStage;
  progressPercentage: number;
};

export type TypeSignature = {
  rawType: string;
  arguments: TypeSignatureArgument[];
};

export type TypeSignatureArgument =
  | { kind: "NAMED_TYPE"; value: { fieldName?: { name: string }; typeSignature: TypeSignature } }
  | { kind: "TYPE"; value: TypeSignature }
  | { kind: "LONG"; value: number };

export type Column = { name: string; type: string; typeSignature: TypeSignature };
export type Columns = Column[];

export type QueryData = any[];

export type QueryFailureInfo = {
  type: string;
  message: string;
  suppressed: string[];
  stack: string[];
};

export type ErrorLocation = {
  lineNumber: number;
  columnNumber: number;
};

export type QueryError = {
  message: string;
  errorCode: number;
  errorName: string;
  errorType: string;
  errorLocation?: ErrorLocation;
  failureInfo: QueryFailureInfo;
};

export type QueryResult = {
  id: string;
  infoUri?: string;
  nextUri?: string;
  columns?: Columns;
  data?: QueryData[];
  stats?: QueryStats;
  warnings?: string[];
  error?: QueryError;
};

export type Query = {
  query: string;
  extraHeaders?: RequestHeaders;
};

type FetchRequestConfig = {
  method?: string;
  url?: string;
  data?: unknown;
  headers?: RequestHeaders;
};

/**
 * A fetch wrapper that keeps Trino's session in step across the requests of
 * one query — and hands what changed back out, so that it can be kept across
 * queries too.
 *
 * Trino has no session of its own: the catalog, the schema, the session
 * properties and the prepared statements are headers the client sends, and a
 * statement that changes them (`USE`, `SET SESSION`, `PREPARE`) answers with
 * `Set-*`/`Clear-*`/`Added-Prepare` headers that the client is expected to
 * fold in. `session.ts` is that fold; this class applies it after every
 * response and reports the delta through `onSessionChange`.
 *
 * One instance per query, and not safe to share: two concurrent queries on
 * one instance would fold each other's changes into a request already on its
 * way. Sharing across *sequential* queries is what `onSessionChange` and the
 * `session` option are for, without sharing the instance.
 */
export default class Trino {
  private session: SessionState;

  private constructor(
    private readonly baseURL: string,
    private readonly options: ConnectionOptions
  ) {
    this.session = options.session ?? EMPTY_SESSION;
  }

  // Who the query runs as is not the browser's to say: the proxy sets
  // X-Trino-User from the identity the access gate established, and refuses to
  // forward any header the client sends that would name somebody else.
  static create(options: ConnectionOptions): Trino {
    return new Trino(options.server, options);
  }

  /** The headers this request starts from: the session, and what is fixed. */
  private baseHeaders(): RequestHeaders {
    return {
      [TRINO_SOURCE_HEADER]: this.options.source ?? DEFAULT_SOURCE,
      ...sessionHeaders(this.session),
      ...(this.options.extraHeaders ?? {})
    };
  }

  /**
   * Generic method to send a request to the server.
   * @param cfg - FetchRequestConfig
   * @returns The response data.
   */
  async request<T>(cfg: FetchRequestConfig): Promise<T> {
    const url = cfg.url?.startsWith("http") ? cfg.url : `${this.baseURL}${cfg.url ?? ""}`;

    const init: globalThis.RequestInit = {
      method: cfg.method ?? "GET",
      headers: { ...this.baseHeaders(), ...(cfg.headers ?? {}) }
    };

    if (cfg.data !== undefined) {
      init.body = typeof cfg.data === "string" ? cfg.data : JSON.stringify(cfg.data);
    }

    const response = await fetch(url, init);

    if (!response.ok) {
      throw await HttpError.from(response);
    }

    const delta = sessionDelta(response.headers);
    if (delta) {
      this.session = applyDelta(this.session, delta);
      this.options.onSessionChange?.(delta);
    }

    // Cancelling a query answers 204 with an empty body, and a HEAD has none
    // by definition — json() throws on either.
    if (response.status === 204 || init.method === "HEAD") {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  /**
   * It takes a query object and returns a promise that resolves to a query result object
   * @param {Query | string} query - The query to execute.
   * @returns A promise that resolves to a QueryResult object.
   */
  async query(query: Query | string): Promise<QueryIterator> {
    const req = typeof query === "string" ? { query } : query;
    const requestConfig: FetchRequestConfig = {
      method: "POST",
      url: "/v1/statement",
      data: req.query,
      headers: req.extraHeaders ?? {}
    };
    return this.request<QueryResult>(requestConfig).then(
      (result) => new QueryIterator(this, result)
    );
  }

  /**
   * Keeps a query alive without advancing it: a HEAD on the current `nextUri`
   * resets Trino's `query.client.timeout` clock, where a GET would consume the
   * page.
   */
  async heartbeat(nextUri: string): Promise<void> {
    await this.request<void>({ url: nextUri, method: "HEAD" });
  }

  /**
   * It cancels a query.
   * @param {string} queryId - The queryId of the query to cancel.
   * @returns The result of the query.
   */
  async cancel(queryId: string): Promise<QueryResult> {
    return this.request({ url: `/v1/query/${queryId}`, method: "DELETE" }).then(
      (_) => <QueryResult>{ id: queryId }
    );
  }
}

/**
 * Iterator for the query result data.
 */
export class QueryIterator implements AsyncIterableIterator<QueryResult> {
  private finished = false;

  constructor(
    private readonly client: Trino,
    private queryResult: QueryResult
  ) {}

  [Symbol.asyncIterator](): AsyncIterableIterator<QueryResult> {
    return this;
  }

  /**
   * It returns true if the queryResult object has a nextUri property, and false otherwise
   * @returns A boolean value.
   */
  hasNext(): boolean {
    return !!this.queryResult.nextUri;
  }

  /**
   * Retrieves the next QueryResult available. The final chunk (no nextUri) is
   * yielded once with done: false — for-await ignores value when done is true,
   * so returning it as done would drop the entire result for queries that
   * finish in a single batch.
   */
  async next(): Promise<IteratorResult<QueryResult>> {
    if (this.hasNext()) {
      this.queryResult = await this.client.request<QueryResult>({
        url: this.queryResult.nextUri
      });
      return { value: this.queryResult, done: false };
    }
    if (this.finished) {
      return { value: this.queryResult, done: true };
    }
    this.finished = true;
    return { value: this.queryResult, done: false };
  }
}
