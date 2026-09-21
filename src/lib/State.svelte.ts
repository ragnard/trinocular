import Trino from "$lib/trino";
import { signedOut } from "$lib/signedOut";
import { Rows } from "$lib/Rows";
import type { Columns, QueryData, QueryError, QueryStats, Retry, SessionDelta } from "$lib/trino";
import { describeIgnored } from "$lib/trino/session";
import { fileLineMessage } from "$lib/trino/errors";
import { TrinoSession } from "$lib/trino/TrinoSession.svelte";
import { CatalogCache } from "$lib/catalog/CatalogCache.svelte";
import type { ClientConnection } from "$lib/server/connectionAuthz";
import type { ResultsConfig } from "$lib/server/config";
import { underPath } from "$lib/viewFormats";
import type { FileRecord, StoredFile } from "$lib/workspaceRecord";
import type { LoadedWorkspace, WorkspaceStore } from "$lib/workspaceStore";
import { WorkspaceSaver } from "$lib/workspaceSaver";

const MAX_RESULTS_PER_FILE = 10;

/**
 * Rows the workspace keeps for results nobody is looking at. Past it, the
 * oldest finished results let their rows go — keeping their columns, stats
 * and error — until the total is back under. A count of rows rather than of
 * results, because twenty small queries in one file cost nothing and should
 * all stay, while one "fetch all" is the thing that needs reclaiming. The
 * result on screen, a running one and a held one are never released.
 */
export const ROW_BUDGET = 500_000;

export const DEFAULT_ROW_LIMIT = 1000;

/**
 * The most a single run may bring into the browser, `results` in the config:
 * `maxRows`, and `maxBytes` of the JSON its pages arrived as, whichever is
 * crossed first. Rows are what the banner can say and what the rail's limit
 * is clamped to; bytes are what actually bounds memory, since a row of one
 * integer and a row of twenty JSON documents are the same count. A row's
 * heap cost is some multiple of its wire size (V8's string headers on a wide
 * row of short strings, mostly), so the bytes side is a proxy too, but one
 * that holds for any shape of row. Unlike the cap, which *holds* the query
 * and asks, the ceiling *stops* it: there is no "more" to ask for past it,
 * and a held query keeps its memory and its slot on the cluster.
 */
export type ResultCeiling = ResultsConfig;

/** Why a result stopped short of the cluster's last row. */
export type Stopped = "user" | "expired" | "max-rows" | "max-bytes";

/** A poll being retried; see `Result.reconnecting`. */
export type Reconnecting = { attempts: number; message: string };

/** Must stay under Trino's `query.client.timeout`, five minutes by default. */
const HEARTBEAT_MS = 30_000;

/** A held query keeps its memory and resource-group slot on the cluster. */
export const MAX_HOLD_MS = 10 * 60_000;

type Resume = "more" | "all" | "stop";

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

/** What a run and the schema browser both say when the server offered no clusters. */
export const NO_CONNECTIONS =
  "No connections are configured. Name a cluster under `connections` in the config file, " +
  "or start Trinocular with TRINO_URL.";

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
  /** Things the run itself has to say — a session change that was not carried. */
  notices: string[] = $state.raw([]);
  /** Split counts over time; see `ProgressSample`. */
  progress: ProgressSample[] = $state.raw([]);
  #sampleInterval = MIN_SAMPLE_INTERVAL_MS;
  #lastSampleAt = -Infinity;
  #lastSampledState?: string;
  /** A cancel has been asked for; the query has not settled on it yet. */
  cancelRequested: boolean = $state(false);
  /**
   * The last poll failed transiently and the client is retrying it; what it
   * failed with, and how many times so far. Null once a chunk arrives again
   * or the run settles, so a stall is never silent and a recovery leaves no
   * trace.
   */
  reconnecting: Reconnecting | null = $state(null);
  #cancelSent = false;
  /** The result was dropped from its file; nothing will read further chunks. */
  #discarded = false;

  /** Rows to show before pausing to ask, or null for all of them. */
  limit: number | null = $state(null);
  #step: number;
  /** Paused at the cap with more rows to be had; heartbeats keep the query alive. */
  held: boolean = $state(false);
  /** Stopped at the cap — by the reader or by the hold running out — or at the ceiling. */
  stopped: false | Stopped = $state(false);
  /** The rows were let go to free memory; how many there were, or null. */
  released: number | null = $state(null);
  /** Characters of JSON the rows arrived as; the ceiling's bytes side counts this. */
  size: number = $state(0);
  readonly ceiling: ResultCeiling;
  /** The part of the page that crossed the cap; `fetchMore` takes from it first. */
  #pending: readonly QueryData[] = [];
  /** `#pending`'s share of its page's size, counted when it is taken. */
  #pendingSize = 0;
  /** What cut the page `#pending` came from, when it was the ceiling. */
  #cutBy: "max-rows" | "max-bytes" | null = null;
  #resume?: (action: Resume) => void;
  #heldUri?: string;

  constructor(
    client: Trino,
    sql: string,
    startLine: number,
    anchorId: string,
    ceiling: ResultCeiling,
    limit: number | null = null
  ) {
    this.client = client;
    this.id = crypto.randomUUID();
    this.sql = sql;
    this.startLine = startLine;
    this.anchorId = anchorId;
    this.ceiling = ceiling;
    this.limit = limit;
    this.#step = limit ?? DEFAULT_ROW_LIMIT;
  }

  get step(): number {
    return this.#step;
  }

  queryState?: State = $derived(this.stats?.state as State);
  completed?: boolean = $derived(
    this.error != null ||
      this.stopped !== false ||
      (this.queryState && COMPLETED_STATES.has(this.queryState))
  );
  running?: boolean = $derived(!this.completed);
  rowCount?: number = $derived(this.data.length);
  cancelling?: boolean = $derived(this.cancelRequested && !this.completed);
  /** Trino reports a killed query as a USER_CANCELED failure. */
  canceled?: boolean = $derived(this.error?.errorName === "USER_CANCELED");
  /**
   * `error.message` with its `line N:M:` moved to the file's lines, the way
   * the editor marker already is — what the pane, the marker and the copy
   * button all show, so nobody is sent to the statement's line 1.
   */
  errorMessage?: string = $derived.by(
    () => this.error && fileLineMessage(this.error.message, this.startLine)
  );

  /** Always a string, always one decimal. It renders straight into the results
   *  rail as `{elapsedTimeSeconds} s`, and returning the number 0 before Trino
   *  has reported any timing drew "0 s" among readings that all otherwise read
   *  "12.3 s" — a different shape for the one value that is not yet news. */
  elapsedTimeSeconds: string = $derived(((this.stats?.elapsedTimeMillis ?? 0) / 1000).toFixed(1));

  async execute() {
    try {
      const res = await this.client.query(this.sql);
      for await (const chunk of res) {
        // A chunk is the cluster answering again.
        this.reconnecting = null;
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

        if (chunk.data) this.#take(chunk.data, chunk.size ?? 0);

        // A loop: the held-back tail can exceed the step a resume adds, in
        // which case the query is held again without another page requested.
        while (this.#atCap()) {
          // Cut by the ceiling rather than the cap: nothing to hold for.
          if (this.#cutBy) {
            this.#truncate(this.#cutBy, chunk.nextUri);
            return;
          }
          const action = await this.#hold(chunk.nextUri);
          if (action === "stop") return;
          const pending = this.#pending;
          const pendingSize = this.#pendingSize;
          this.#pending = [];
          this.#pendingSize = 0;
          this.#take(pending, pendingSize);
        }
      }
    } catch (e) {
      this.reconnecting = null;
      if (signedOut(e)) return;
      this.fail(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * The client's `onRetry`: a poll failed transiently and will be tried
   * again (see `Trino.nextChunk`). Declined once a cancel or a discard has
   * been asked for — the DELETE may or may not have reached the cluster, but
   * either way nobody is waiting for the page, and two minutes of polling
   * for a query the reader gave up on would only keep `Cancelling…` on
   * screen for that long. Declined, the failure settles the result as any
   * other would.
   */
  retry({ attempts, error }: Retry): boolean {
    if (this.#discarded || this.cancelRequested) return false;
    this.reconnecting = { attempts, message: error.message };
    return true;
  }

  /** Something the run has to say that is not an error; see `notices`. */
  notify(messages: string[]) {
    this.notices = [...this.notices, ...messages];
  }

  /** Settles the result on a failure of ours rather than the cluster's. */
  fail(message: string) {
    this.error = {
      message,
      errorCode: 0,
      errorName: "CLIENT_ERROR",
      errorType: "CLIENT_ERROR",
      failureInfo: { type: "ClientError", message, suppressed: [], stack: [] }
    };
  }

  /**
   * Appends a page, cut at the cap or the ceiling, whichever is nearer: a
   * page is sized in bytes, and one of narrow rows can run to tens of
   * thousands. The ceiling's bytes side cuts a page in proportion, every row
   * taken as the page's average, since the rows are not measured one by one;
   * `size` is the page's share of the wire, and pending rows carry theirs
   * with them. `append` returns a new Rows sharing the pages already held,
   * which is how $state.raw notices.
   */
  #take(page: readonly QueryData[], size: number) {
    const capRoom = this.limit == null ? Infinity : this.limit - this.data.length;
    const rowsRoom = this.ceiling.maxRows - this.data.length;
    const bytesRoom =
      this.size + size > this.ceiling.maxBytes
        ? Math.floor((page.length * (this.ceiling.maxBytes - this.size)) / size)
        : Infinity;
    const room = Math.max(0, Math.min(capRoom, rowsRoom, bytesRoom));
    if (page.length <= room) {
      this.data = this.data.append(page);
      this.size += size;
      this.#cutBy = null;
      return;
    }
    this.data = this.data.append(page.slice(0, room));
    const taken = Math.floor((size * room) / page.length);
    this.size += taken;
    this.#pending = page.slice(room);
    this.#pendingSize = size - taken;
    // The ceiling wins a tie with the cap: holding for a "more" that cannot
    // be answered would keep the query on the cluster for nothing.
    this.#cutBy = bytesRoom <= room ? "max-bytes" : rowsRoom <= room ? "max-rows" : null;
  }

  /**
   * Held only once rows have actually been held back, not the moment the
   * count reaches the cap: with rows still to come the next page settles it
   * either way, and a query of exactly the cap ends instead of claiming more.
   * The same rule serves the ceiling, with `#cutBy` saying which it was.
   */
  #atCap(): boolean {
    return this.#pending.length > 0;
  }

  /**
   * Not asking for the next page is what holds the query; the heartbeat is
   * what keeps the cluster from reading that silence as an abandoned client.
   * With no `nextUri` the last page has already arrived and there is nothing
   * on the cluster to keep alive or to stop.
   */
  #hold(nextUri: string | undefined): Promise<Resume> {
    this.held = true;
    this.#heldUri = nextUri;
    const heartbeat = nextUri
      ? setInterval(() => void this.#sendHeartbeat(nextUri), HEARTBEAT_MS)
      : undefined;
    const expiry = nextUri ? setTimeout(() => this.stop("expired"), MAX_HOLD_MS) : undefined;
    return new Promise<Resume>((resolve) => {
      this.#resume = resolve;
    }).finally(() => {
      clearInterval(heartbeat);
      clearTimeout(expiry);
      this.#resume = undefined;
      this.#heldUri = undefined;
      this.held = false;
    });
  }

  async #sendHeartbeat(nextUri: string) {
    try {
      await this.client.heartbeat(nextUri);
    } catch (e) {
      signedOut(e);
      // Anything else surfaces on the resumed poll, with a message.
    }
  }

  fetchMore() {
    if (!this.held) return;
    this.limit = (this.limit ?? 0) + this.#step;
    this.#resume?.("more");
  }

  /** "All" is up to the ceiling, which `#take` applies whatever the cap says. */
  fetchAll() {
    if (!this.held) return;
    this.limit = null;
    this.#resume?.("all");
  }

  /**
   * Nobody is polling a held query, so the USER_CANCELED chunk that settles
   * every other cancel never arrives; `stopped` settles it locally instead.
   */
  stop(reason: "user" | "expired" = "user") {
    if (!this.held) return;
    this.#truncate(reason, this.#heldUri);
    this.#resume?.("stop");
  }

  /**
   * Settles the result short of the cluster's last row, keeping what it has.
   * With a `nextUri` there is a query still on the cluster to cancel; without
   * one the last page has already arrived and there is nothing to stop.
   */
  #truncate(reason: Stopped, nextUri: string | undefined) {
    this.#pending = [];
    this.#pendingSize = 0;
    this.stopped = reason;
    if (nextUri) {
      this.cancelRequested = true;
      void this.#sendCancel();
    }
  }

  /**
   * Lets the rows go, keeping everything else — the columns, the stats, the
   * error — so the result still reads as what it was. Only for a result that
   * has settled: a running one is still being filled, and a held one still
   * has a query on the cluster to answer for.
   */
  release() {
    if (this.released !== null || !this.completed || this.held) return;
    if (this.data.length === 0) return;
    this.released = this.data.length;
    this.data = Rows.empty;
    this.#pending = [];
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
    if (this.held) return this.stop();
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
    if (!this.completed) {
      if (this.held) this.stop();
      else {
        // Also makes `execute` fire the DELETE if the query id has not arrived yet.
        this.cancelRequested = true;
        void this.#sendCancel();
      }
    }
    // Nothing can show these rows again, and a `$derived` that read `data`
    // keeps the old signal, value and all, until it is next evaluated — which
    // for a result pane whose result went null is never. Dropping them here
    // is what actually frees them.
    this.data = Rows.empty;
    this.#pending = [];
  }

  async #sendCancel() {
    if (this.#cancelSent || !this.queryId) return;
    this.#cancelSent = true;
    try {
      await this.client.cancel(this.queryId);
    } catch (e) {
      if (signedOut(e)) return;
      // The query may have finished between the click and the request; the
      // polling loop reports whatever state it actually settled in.
    }
  }
}

/** What a new document may start out as; everything is optional, and a plain
 *  `createFile()` is still the empty one the `New file` menu item makes. */
export type NewFile = { content?: string; name?: string };

export class SqlFile {
  id: string;
  name: string = $state("");
  content: string = $state("");
  /**
   * How the inspector draws a field, keyed by the path the inspector shows
   * (`items[3].meta`, indices and all). Held across rows, since that much is a
   * property of the column, but not across elements: a varchar array can carry
   * a JSON document in one element and a sentence in the next, so collapsing
   * the index would make one click re-type the whole array.
   *
   * A property of the document: a workspace-wide map would let a column
   * called `payload` in one document silently re-type `payload` in another,
   * and a per-result one would be thrown away by the thing you do most, which
   * is run the query again. It is
   * only ever consulted with `viewFormats.ts`, which reads an id it does not
   * know as the default — so a stored choice can outlive the format that
   * served it, and a column can come back as a different type.
   */
  viewFormats: Record<string, string> = $state({});
  results: Result[] = $state([]);
  activeResult: Result | null = $state.raw(null);

  constructor(
    id: string,
    name: string,
    content: string = "",
    viewFormats: Record<string, string> = {}
  ) {
    this.id = id;
    this.name = name;
    this.content = content;
    this.viewFormats = viewFormats;
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
  /** The clusters this user may use, as the server listed them. */
  readonly connections: readonly ClientConnection[];
  /** What a workspace runs against until it has chosen, and what a stored
   *  choice the config no longer declares is healed to. */
  defaultConnectionId: string;
  #connectionIds: Set<string>;
  /**
   * The Trino cluster every document's statements run against, and what the
   * schema browser shows. One for the workspace, not one per document: the
   * cluster is the place you are working in, and the files are what you are
   * working on there. It was per file once, and the connection chip then sat
   * in the document header, where switching files could silently switch
   * clusters under a browser tree that still showed the old one.
   */
  connectionId: string = $state("");
  /**
   * False when the server offered no clusters at all. Every id then heals to
   * `""`, which is a proxy path that can only 404, so the places that would
   * ask the cluster something say so instead of asking.
   */
  readonly hasConnections: boolean;

  files: SqlFile[] = $state([]);
  activeFile: SqlFile | null = $state.raw(null);
  /**
   * Queries of this tab's that the cluster still has: running, or held at the
   * row cap. Closing the tab abandons them, and their rows with it.
   */
  running: number = $derived(
    this.files.reduce((n, file) => n + file.results.filter((r) => r.running).length, 0)
  );
  /** The most any run brings into the browser; see `ResultCeiling`. */
  readonly ceiling: ResultCeiling;
  /** Rows a new run shows before pausing to ask, when `limitRows` is on. */
  rowLimit: number = $state(DEFAULT_ROW_LIMIT);
  limitRows: boolean = $state(true);

  /**
   * One catalog cache per connection, kept for the session. Browsing a Trino
   * cluster is slow enough that dropping the tree on every switch is felt, so
   * coming back to a cluster finds its tree as you left it.
   *
   * Built up front, one per configured connection, and **never lazily**. A
   * `CatalogCache` is made of runes, and svelte does not register a dependency
   * on a source that was created by the reaction currently running -- there is
   * nothing to notify, since the reaction is producing the value in the same
   * pass. So a cache constructed on first use was constructed inside whichever
   * `$derived` or `$effect` asked for it first, and that reader's read of
   * `catalogs` registered nothing: switching a document to another cluster left
   * the schema browser empty, root and all, because `SHOW CATALOGS` came back
   * and invalidated nobody. It filled in on the *second* visit, the instance by
   * then having been built in an earlier pass, which is what made it look like
   * a loading race rather than a missing subscription. Constructing every cache
   * here, outside any reaction, is what makes the reads that matter trackable.
   * Costs nothing: a cache is empty maps and a `Trino` client, and neither
   * touches the network until something asks it to.
   */
  #catalogs = new Map<string, CatalogCache>();
  /**
   * The session each connection's statements run in — catalog, schema,
   * session properties, prepared statements — kept here so that it outlives
   * the run that changed it: `USE tpch.tiny` is a statement whose whole
   * effect is on the *next* statement. One per connection, for the reason the
   * caches are, and built alongside them, for the reason they are built here.
   * The metadata clients the caches hold deliberately do not carry it: a
   * `SHOW TABLES` is fully qualified already.
   */
  #sessions = new Map<string, TrinoSession>();

  #store: WorkspaceStore;
  /**
   * What sends the documents to the store, and only the ones that changed.
   * Seeded from what was loaded, which is the whole of why two tabs do not
   * overwrite each other: a tab that has not touched a document never writes
   * it, so it cannot put back the copy it happened to load.
   */
  #saver: WorkspaceSaver;
  /** A save has failed and is being retried: the edit is still only here. */
  saveFailed = $state(false);

  /**
   * `connections` is the configured set, newest config wins: a stored choice
   * naming a connection the config no longer declares is pointed back at the
   * default, since its own id can only ever 404 at the proxy.
   */
  constructor(
    connections: readonly ClientConnection[],
    store: WorkspaceStore,
    loaded: LoadedWorkspace,
    ceiling: ResultCeiling,
    id: string = "default"
  ) {
    this.id = id;
    this.connections = connections;
    this.ceiling = ceiling;
    // A cap above the ceiling would never hold, only stop.
    this.rowLimit = Math.min(DEFAULT_ROW_LIMIT, ceiling.maxRows);
    this.#store = store;
    this.#saver = new WorkspaceSaver(store, {
      isActive: (fileId) => this.activeFile?.id === fileId,
      applyRemote: (record) => this.#applyRemoteFile(record),
      applyRemoved: (fileId) => this.#applyRemoteRemoval(fileId),
      onTrouble: (failing) => {
        if (this.saveFailed !== failing) this.saveFailed = failing;
      },
      signedOut,
      report: (message) => console.error(`trinocular: ${message}`)
    });
    this.#connectionIds = new Set(connections.map((c) => c.id));
    this.hasConnections = connections.length > 0;
    this.defaultConnectionId = connections[0]?.id ?? "";
    // Every id `#knownConnection` can hand back, so `catalogFor` is a lookup
    // that always hits. `defaultConnectionId` is already one of the configured
    // ids unless there are none at all, in which case it is "" and this seeds
    // the one entry that keeps the degenerate case a lookup too.
    for (const id of [...this.#connectionIds, this.defaultConnectionId]) {
      this.#catalogs.set(id, new CatalogCache(this.#createClient(id)));
      this.#sessions.set(id, new TrinoSession());
    }
    this.connectionId = this.#knownConnection(loaded.connectionId);
    this.#restoreFiles(loaded);
  }

  #knownConnection(connectionId: string | undefined): string {
    return connectionId && this.#connectionIds.has(connectionId)
      ? connectionId
      : this.defaultConnectionId;
  }

  /** A client for metadata: no session, and nothing to report back. */
  #createClient(connectionId: string): Trino {
    return Trino.create({ server: `/api/trino/${connectionId}` });
  }

  /**
   * A client for a statement: starts from the connection's session and folds
   * what its responses change back into it, so the next statement starts
   * from there. A change the client will not carry is reported through
   * `onIgnored`, so the statement that asked for it does not read as having
   * worked.
   */
  #createSessionClient(
    connectionId: string,
    onIgnored: (notices: string[]) => void,
    onRetry: (retry: Retry) => boolean
  ): Trino {
    const session = this.sessionFor(connectionId);
    return Trino.create({
      server: `/api/trino/${connectionId}`,
      session: session.state,
      onSessionChange: (delta: SessionDelta) => {
        session.apply(delta);
        if (delta.ignored.length > 0) onIgnored(delta.ignored.map(describeIgnored));
      },
      onRetry
    });
  }

  /** The session a connection's statements run in; see `#sessions`. */
  sessionFor(connectionId: string): TrinoSession {
    return this.#sessions.get(this.#knownConnection(connectionId))!;
  }

  /** The session of the current connection. */
  get session(): TrinoSession {
    return this.sessionFor(this.connectionId);
  }

  /**
   * The cache for a connection. Healed through `#knownConnection` for the same
   * reason everything else is -- an id the config does not declare can only
   * 404 at the proxy -- which also makes the map total over every id this can
   * be asked for, so there is nothing to construct here.
   */
  catalogFor(connectionId: string): CatalogCache {
    return this.#catalogs.get(this.#knownConnection(connectionId))!;
  }

  /** What to call a connection on screen: its name, or its id when the list
   *  does not know it, or nothing at all when there are none to know. */
  connectionName(connectionId: string): string {
    return (
      this.connections.find((c) => c.id === connectionId)?.name || connectionId || "No connection"
    );
  }

  /** The schema of the current connection. */
  get catalog(): CatalogCache {
    return this.catalogFor(this.connectionId);
  }

  setConnection(connectionId: string) {
    const next = this.#knownConnection(connectionId);
    if (this.connectionId === next) return;
    this.connectionId = next;
    this.persist();
  }

  /**
   * Records how the inspector is to draw a field of this document — either one
   * element (`items[3]`) or every element of an array (`items[]`).
   *
   * Choosing for the array clears the elements that were chosen out of it one
   * at a time, because the element is what wins when both are set: leaving
   * them would mean picking `Text` for every element and watching three of
   * them stay JSON, with the menu quietly showing both as chosen.
   */
  setViewFormat(file: SqlFile, path: string, formatId: string) {
    let changed = false;
    for (const key of Object.keys(file.viewFormats)) {
      if (underPath(key, path)) {
        delete file.viewFormats[key];
        changed = true;
      }
    }
    if (file.viewFormats[path] !== formatId) {
      file.viewFormats[path] = formatId;
      changed = true;
    }
    if (changed) this.persist();
  }

  #restoreFiles(stored: LoadedWorkspace) {
    this.#saver.seed(stored.files);

    this.files = stored.files.map((f) => new SqlFile(f.id, f.name, f.content, f.viewFormats));
    if (this.files.length === 0) this.files = [this.#scratchFile()];
    this.activeFile = this.files.find((f) => f.id === stored.activeFileId) ?? this.files[0];
  }

  #scratchFile(): SqlFile {
    return new SqlFile(crypto.randomUUID(), "scratch.sql");
  }

  #record(file: SqlFile): StoredFile {
    return {
      id: file.id,
      name: file.name,
      content: file.content,
      viewFormats: { ...file.viewFormats }
    };
  }

  /**
   * Hands every document to the saver, which writes the ones whose contents
   * differ from what it last wrote and removes the ones that have gone.
   * Called on a debounce while typing, so the comparison is what keeps a
   * keystroke from rewriting every open document -- and, more importantly,
   * from rewriting documents this tab has not touched at all.
   */
  persist() {
    this.#saver.update(
      this.files.map((file) => this.#record(file)),
      {
        activeFileId: this.activeFile?.id,
        order: this.files.map((f) => f.id),
        connectionId: this.connectionId
      }
    );
  }

  /** The page is going away: what the debounce is holding goes out now. */
  flush() {
    this.#saver.flush(() => this.persist());
  }

  openFile(file: SqlFile) {
    this.activeFile = file;
    // Which document you are in is part of the workspace now that the file
    // list is a switcher rather than something on screen to re-pick.
    this.persist();
  }

  createFile(opts: NewFile = {}) {
    const names = new Set(this.files.map((f) => f.name));
    let n = 1;
    while (names.has(`query-${n}.sql`)) n++;
    const file = new SqlFile(crypto.randomUUID(), opts.name || `query-${n}.sql`, opts.content);
    this.files.unshift(file);
    this.activeFile = file;
    this.persist();
    return file;
  }

  /**
   * Opens SQL that arrived in a link. Always a *new* document: a link must
   * never be able to append to or replace what somebody is editing, which is
   * the one thing that would make following one dangerous rather than merely
   * something to read first. It is never run — see `openLink.ts`.
   */
  openLinkedFile(sql: string, name: string | null) {
    return this.createFile({ content: sql, name: name ?? undefined });
  }

  deleteFile(file: SqlFile) {
    const index = this.files.indexOf(file);
    if (index === -1) return;
    this.files.splice(index, 1);
    // The file's results go with it — stop anything still running.
    for (const result of file.results) result.discard();
    if (this.files.length === 0) this.files.push(this.#scratchFile());
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
    // One client per run, seeded from the connection's session: the client
    // folds each response's session changes into its own headers as it goes,
    // which is not safe to share across concurrent runs, so what outlives the
    // run is the session and not the client.
    // `result` is read by the callbacks only once a response is in, long
    // after the assignment below.
    const result: Result = new Result(
      this.#createSessionClient(
        this.connectionId,
        (notices) => result.notify(notices),
        (retry) => result.retry(retry)
      ),
      sql,
      startLine,
      anchorId,
      this.ceiling,
      this.limitRows ? this.rowLimit : null
    );
    file.addResult(result, replacesId);
    if (!this.hasConnections) {
      result.fail(NO_CONNECTIONS);
      return;
    }
    // Budgeted when the run starts and again when it settles: a result's size
    // is only known at the end, and the end is when it can push the total
    // over.
    this.#releaseRows();
    void result.execute().then(() => this.#releaseRows());
  }

  /**
   * Brings the rows held across every file back under `ROW_BUDGET`, largest
   * result first — oldest first between equals. Largest, because the point is
   * the memory and not the tidiness: releasing oldest-first threw away a run
   * of three-row results before it reached the one that had put the total
   * over. Everything with rows counts toward the total, including what cannot
   * be released; only the finished, unheld results not on screen are
   * candidates. `release` declines the rest anyway.
   */
  #releaseRows() {
    const showing = this.activeFile?.activeResult;
    let held = 0;
    const candidates: Result[] = [];
    for (const file of this.files) {
      for (const result of file.results) {
        if (result.released !== null) continue;
        held += result.data.length;
        if (result !== showing && result.completed && !result.held && result.data.length > 0) {
          candidates.push(result);
        }
      }
    }
    candidates.sort((a, b) => b.data.length - a.data.length || a.startedAt - b.startedAt);
    for (const result of candidates) {
      if (held <= ROW_BUDGET) break;
      held -= result.data.length;
      result.release();
    }
  }

  /**
   * Follows what other tabs do to this workspace. Returns a disposer, so a
   * component can hold it in an `$effect`.
   *
   * The rules come from where a document's text actually lives. `Editor.svelte`
   * builds a monaco model from `SqlFile.content` *once* and caches it in a
   * WeakMap keyed by the `SqlFile`; after that the model is the truth and
   * writing to `content` would not reach the screen. So:
   *
   *  - The file open in this tab is never touched. Its text is under a caret
   *    that somebody is using, and replacing it from another tab would either
   *    do nothing visible or move the cursor out from under them.
   *  - Any other file whose text changed is *replaced* rather than mutated.
   *    A new `SqlFile` is a new WeakMap key, which is what guarantees the
   *    stale model is dropped and a fresh one is built from the new text next
   *    time the document is opened. Its results go with it: they belong to
   *    statements that no longer exist.
   *  - A name change is applied in place, since a name is nothing monaco
   *    holds.
   */
  watchStore(): () => void {
    return this.#store.watch({
      onFile: (record) => this.#applyRemoteFile(record),
      onFileRemoved: (fileId) => this.#applyRemoteRemoval(fileId),
      onOrder: (order) => this.#applyRemoteOrder(order)
    });
  }

  #applyRemoteFile(record: FileRecord) {
    // Record it as seen, so this tab does not write the value straight back.
    this.#saver.noteRemote(record);
    const existing = this.files.find((f) => f.id === record.id);

    if (!existing) {
      this.files.push(new SqlFile(record.id, record.name, record.content, record.viewFormats));
      return;
    }

    if (existing === this.activeFile || existing.content === record.content) {
      existing.name = record.name;
      // In place, like the name: how a value is drawn is nothing monaco holds.
      existing.viewFormats = record.viewFormats;
      return;
    }

    const replacement = new SqlFile(record.id, record.name, record.content, record.viewFormats);
    this.files[this.files.indexOf(existing)] = replacement;
    for (const result of existing.results) result.discard();
  }

  #applyRemoteRemoval(fileId: string) {
    this.#saver.noteRemoved(fileId);
    const index = this.files.findIndex((f) => f.id === fileId);
    if (index === -1) return;

    const [removed] = this.files.splice(index, 1);
    for (const result of removed.results) result.discard();
    if (this.files.length === 0) this.files.push(this.#scratchFile());
    if (this.activeFile === removed) this.activeFile = this.files[0];
  }

  /** Reorders to match another tab's listing. Ids naming nothing are ignored,
   *  and files the order does not mention keep their place at the end. */
  #applyRemoteOrder(order: string[]) {
    const rank = new Map(order.map((id, i) => [id, i]));
    const at = (file: SqlFile) => rank.get(file.id) ?? Number.MAX_SAFE_INTEGER;
    this.files = [...this.files].sort((a, b) => at(a) - at(b));
  }

  showResult(result: Result) {
    this.activeFile?.showResult(result);
  }
}
