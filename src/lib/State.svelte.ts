import Trino, { HttpError } from "$lib/trino";
import { Rows } from "$lib/Rows";
import type { Columns, QueryError, QueryStats } from "$lib/trino";
import { CatalogCache } from "$lib/catalog/CatalogCache.svelte";
import { loadFiles, saveFiles, legacyEditorContent, clearLegacyEditor } from "$lib/fileStorage";

const MAX_RESULTS_PER_FILE = 10;

export type State =
  | "QUEUED"
  | "WAITING_FOR_RESOURCES"
  | "DISPATCHING"
  | "PLANNING"
  | "STARTING"
  | "RUNNING"
  | "FINISHING"
  | "FINISHED"
  | "FAILED";

const COMPLETED_STATES: Set<State> = new Set(["FINISHED", "FAILED"]);

/**
 * One reading of the query's split counts. Kept as a series, not just a latest
 * value, because the split total is *discovered* while the query runs rather
 * than known up front. A single snapshot cannot tell "half done" apart from
 * "half done against a denominator that has doubled twice", which is what
 * makes Trino's own `progressPercentage` misleading. Plotting the series shows
 * the goalpost moving instead of hiding it.
 */
export type ProgressSample = {
  /** Milliseconds since the run started. */
  t: number;
  completed: number;
  running: number;
  queued: number;
  /** Splits Trino knows about so far; grows as more are scheduled. */
  total: number;
  rows: number;
  bytes: number;
};

/**
 * The history is bounded in samples, not in time: on reaching the cap every
 * other sample is dropped and the sampling interval doubles, so a query that
 * runs for an hour keeps the same shape at half the resolution rather than
 * losing its beginning -- and the beginning, where split discovery happens, is
 * the part worth keeping.
 */
const MAX_PROGRESS_SAMPLES = 240;
const MIN_SAMPLE_INTERVAL_MS = 250;

/**
 * The result of one statement execution. The editor plants a hidden Monaco
 * decoration on the statement's range at run time (`anchorId`); decorations
 * track the text through edits, so the result stays associated with "its"
 * statement even after the statement is changed. Erasing the statement drops
 * the result (see `SqlFile.dropResults`), re-running replaces it (see
 * `SqlFile.addResult`).
 */
export class Result {
  client: Trino;
  id: string;
  anchorId: string;
  startLine: number;
  sql: string;
  startedAt: number = Date.now();

  queryId?: string = $state();
  infoUri?: string = $state();
  columns?: Columns = $state.raw();
  /** The pages Trino sent, not flattened; see `Rows` for why that matters. */
  data: Rows = $state.raw(Rows.empty);
  stats?: QueryStats = $state.raw();
  warnings?: string[] = $state.raw();
  error?: QueryError = $state.raw();
  /** Split counts over time; see `ProgressSample`. */
  progress: ProgressSample[] = $state.raw([]);
  #sampleInterval = MIN_SAMPLE_INTERVAL_MS;
  #lastSampleAt = -Infinity;
  #lastSampledState?: string;
  /** A cancel has been asked for; the query has not settled on it yet. */
  cancelRequested: boolean = $state(false);
  #cancelSent = false;
  /** The result was dropped from its file; nothing will read further chunks. */
  #discarded = false;

  constructor(client: Trino, sql: string, startLine: number, anchorId: string) {
    this.client = client;
    this.id = crypto.randomUUID();
    this.sql = sql;
    this.startLine = startLine;
    this.anchorId = anchorId;
  }

  queryState?: State = $derived(this.stats?.state as State);
  schema?: Columns = $derived(this.columns);
  completed?: boolean = $derived(this.error != null || (this.queryState && COMPLETED_STATES.has(this.queryState)))
  running?: boolean = $derived(!this.completed);
  rowCount?: number = $derived(this.data.length);
  cancelling?: boolean = $derived(this.cancelRequested && !this.completed);
  /** Trino reports a killed query as a USER_CANCELED failure. */
  canceled?: boolean = $derived(this.error?.errorName === "USER_CANCELED");

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
        if (chunk.id) {
          this.queryId = chunk.id;
          // A cancel asked for before Trino handed back an id is sent now.
          if (this.cancelRequested) void this.#sendCancel();
        }
        // Checked after the id is picked up, so a discard that lands before
        // Trino answers the POST still gets its DELETE sent above.
        if (this.#discarded) break;
        if (chunk.infoUri) this.infoUri = chunk.infoUri;
        if (chunk.columns) this.columns = chunk.columns;
        if (chunk.stats) {
          this.stats = chunk.stats;
          this.#sample(chunk.stats);
        }
        if (chunk.warnings) this.warnings = chunk.warnings;
        if (chunk.error) this.error = chunk.error;

        // `append` returns a new Rows sharing the pages already held, so the
        // reference changes (which is the whole of how $state.raw notices)
        // without a row being copied.
        if (chunk.data) this.data = this.data.append(chunk.data);
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

  /**
   * Records one split-count reading. Trino answers a poll as soon as it has
   * anything to say, so chunks arrive far faster than the picture changes;
   * readings are thinned to `#sampleInterval`. A state change is always
   * recorded whatever the interval says, so the series ends on the reading
   * that says FINISHED -- otherwise a query that finishes just after a sample
   * would draw as though it stopped short of done.
   */
  #sample(stats: QueryStats) {
    const now = Date.now();
    if (stats.state === this.#lastSampledState && now - this.#lastSampleAt < this.#sampleInterval) {
      return;
    }
    this.#lastSampleAt = now;
    this.#lastSampledState = stats.state;

    let next = this.progress.concat({
      t: now - this.startedAt,
      completed: stats.completedSplits ?? 0,
      running: stats.runningSplits ?? 0,
      queued: stats.queuedSplits ?? 0,
      total: stats.totalSplits ?? 0,
      rows: stats.processedRows ?? 0,
      bytes: stats.processedBytes ?? 0
    });

    if (next.length > MAX_PROGRESS_SAMPLES) {
      // Halve the resolution, keeping the newest reading: it is the one the
      // bars are drawn from.
      const last = next[next.length - 1];
      next = next.filter((_, i) => i % 2 === 0);
      if (next[next.length - 1] !== last) next.push(last);
      this.#sampleInterval *= 2;
    }

    this.progress = next;
  }

  /**
   * Asks Trino to kill the query. The click can land while the POST that
   * creates the query is still in flight, so the request is remembered and
   * `execute` sends it as soon as a query id arrives. The polling loop is
   * deliberately left running: Trino reports the cancellation as a
   * USER_CANCELED error on a following chunk, which settles the result
   * through the same path as any other failure.
   */
  async cancel() {
    if (this.completed || this.cancelRequested) return;
    this.cancelRequested = true;
    await this.#sendCancel();
  }

  /**
   * Drops a result that has become unreachable — re-run, evicted past
   * MAX_RESULTS_PER_FILE, or its file deleted. Without this the polling loop
   * keeps walking `nextUri` for a result nobody can see or cancel, and the
   * query stays alive on the cluster. Unlike `cancel()` there is no UI left to
   * settle, so the loop stops rather than waiting for the USER_CANCELED chunk.
   */
  discard() {
    if (this.#discarded) return;
    this.#discarded = true;
    if (this.completed) return;
    // Also makes `execute` fire the DELETE if the query id has not arrived yet.
    this.cancelRequested = true;
    void this.#sendCancel();
  }

  async #sendCancel() {
    if (this.#cancelSent || !this.queryId) return;
    this.#cancelSent = true;
    try {
      await this.client.cancel(this.queryId);
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        window.location.href = "/auth/login";
        return;
      }
      // The query may have finished between the click and the request; the
      // polling loop reports whatever state it actually settled in.
    }
  }
}

export class SqlFile {
  id: string;
  name: string = $state("");
  content: string = $state("");
  /**
   * The Trino cluster this document's statements run against. A property of
   * the document, not of the app: switching connection re-points one file,
   * and every other open file keeps meaning what it meant.
   */
  connectionId: string = $state("");
  results: Result[] = $state([]);
  activeResult: Result | null = $state.raw(null);

  constructor(id: string, name: string, content: string = "", connectionId: string = "") {
    this.id = id;
    this.name = name;
    this.content = content;
    this.connectionId = connectionId;
  }

  addResult(result: Result, replacesId?: string) {
    if (replacesId) {
      const index = this.results.findIndex((r) => r.id === replacesId);
      // Re-running a statement abandons the previous run: stop it rather than
      // leaving it polling for a result the pane can no longer reach.
      if (index !== -1) this.results.splice(index, 1)[0].discard();
    }
    this.results.unshift(result);
    // `results` is newest-first, so the oldest goes off the tail.
    while (this.results.length > MAX_RESULTS_PER_FILE) {
      this.results.pop()!.discard();
    }
    this.activeResult = result;
  }

  /**
   * Drops results whose statement was erased (the editor reports their tracked
   * range collapsed). The statement they belonged to is gone and results are
   * never matched to statements by text, so there is nothing left for them to
   * come back to: cutting a statement loses its result, and pasting it
   * elsewhere starts from an empty strip.
   */
  dropResults(dead: Result[]) {
    for (const result of dead) {
      const index = this.results.indexOf(result);
      if (index !== -1) this.results.splice(index, 1)[0].discard();
    }
    if (this.activeResult && dead.includes(this.activeResult)) {
      this.activeResult = null;
    }
  }

  showResult(result: Result) {
    if (this.results.includes(result)) {
      this.activeResult = result;
    }
  }
}

export class Workspace {
  id: string;
  /** Connection for new files, and for files stored before this was per-file. */
  defaultConnectionId: string;
  #connectionIds: Set<string>;

  files: SqlFile[] = $state([]);
  activeFile: SqlFile | null = $state.raw(null);

  /**
   * One catalog cache per connection, kept for the session. Browsing a Trino
   * cluster is slow enough that dropping the tree when the active file changes
   * -- which the old global connection did on every switch -- is felt.
   */
  #catalogs = new Map<string, CatalogCache>();

  /**
   * `connections` is the configured set, newest config wins: a file restored
   * from storage that names a connection the config no longer declares is
   * pointed back at the default, since its own id can only ever 404 at the
   * proxy.
   */
  constructor(connections: { id: string }[], id: string = "default") {
    this.id = id;
    this.#connectionIds = new Set(connections.map((c) => c.id));
    this.defaultConnectionId = connections[0]?.id ?? "";
    this.#restoreFiles();
  }

  #knownConnection(connectionId: string | undefined): string {
    return connectionId && this.#connectionIds.has(connectionId)
      ? connectionId
      : this.defaultConnectionId;
  }

  #createClient(connectionId: string): Trino {
    return Trino.create({ server: `/api/trino/${connectionId}` });
  }

  catalogFor(connectionId: string): CatalogCache {
    let cache = this.#catalogs.get(connectionId);
    if (!cache) {
      cache = new CatalogCache(this.#createClient(connectionId));
      this.#catalogs.set(connectionId, cache);
    }
    return cache;
  }

  /** The connection the active document runs against. */
  get connectionId(): string {
    return this.#knownConnection(this.activeFile?.connectionId);
  }

  /** The schema of the active document's connection. */
  get catalog(): CatalogCache {
    return this.catalogFor(this.connectionId);
  }

  setFileConnection(file: SqlFile, connectionId: string) {
    const next = this.#knownConnection(connectionId);
    if (file.connectionId === next) return;
    file.connectionId = next;
    this.persist();
  }

  #restoreFiles() {
    const stored = loadFiles(this.id);
    if (stored.files.length > 0) {
      this.files = stored.files.map(
        (f) => new SqlFile(f.id, f.name, f.content, this.#knownConnection(f.connectionId))
      );
    } else {
      const legacy = legacyEditorContent(this.id);
      this.files = [
        new SqlFile(crypto.randomUUID(), "scratch.sql", legacy ?? "", this.defaultConnectionId)
      ];
      if (legacy != null) clearLegacyEditor(this.id);
    }
    this.activeFile = this.files.find((f) => f.id === stored.activeFileId) ?? this.files[0];
  }

  persist() {
    saveFiles(
      this.id,
      this.files.map((f) => ({
        id: f.id,
        name: f.name,
        content: f.content,
        connectionId: f.connectionId
      })),
      this.activeFile?.id
    );
  }

  openFile(file: SqlFile) {
    this.activeFile = file;
    // Which document you are in is part of the workspace now that the file
    // list is a switcher rather than something on screen to re-pick.
    this.persist();
  }

  createFile() {
    const names = new Set(this.files.map((f) => f.name));
    let n = 1;
    while (names.has(`query-${n}.sql`)) n++;
    const file = new SqlFile(crypto.randomUUID(), `query-${n}.sql`, "", this.connectionId);
    this.files.unshift(file);
    this.activeFile = file;
    this.persist();
    return file;
  }

  deleteFile(file: SqlFile) {
    const index = this.files.indexOf(file);
    if (index === -1) return;
    this.files.splice(index, 1);
    // The file's results go with it — stop anything still running.
    for (const result of file.results) result.discard();
    if (this.files.length === 0) {
      this.files.push(
        new SqlFile(crypto.randomUUID(), "scratch.sql", "", this.defaultConnectionId)
      );
    }
    if (this.activeFile === file) {
      this.activeFile = this.files[0];
    }
    this.persist();
  }

  renameFile(file: SqlFile, name: string) {
    const trimmed = name.trim();
    if (trimmed) {
      file.name = trimmed;
      this.persist();
    }
  }

  run(sql: string, startLine: number, anchorId: string, replacesId?: string) {
    const file = this.activeFile;
    if (!file) return;
    // One client per run: the Trino client keeps mutable session header state
    // (prepared statements), which is not safe to share across concurrent runs.
    const result = new Result(
      this.#createClient(this.#knownConnection(file.connectionId)),
      sql,
      startLine,
      anchorId
    );
    file.addResult(result, replacesId);
    void result.execute();
  }

  cancel(result: Result) {
    void result.cancel();
  }

  showResult(result: Result) {
    this.activeFile?.showResult(result);
  }
}
