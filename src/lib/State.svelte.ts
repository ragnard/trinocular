import Trino, { HttpError } from "$lib/trino";
import type { Columns, QueryData, QueryError, QueryStats } from "$lib/trino";
import { CatalogCache } from "$lib/catalog/CatalogCache.svelte";
import { loadFiles, saveFiles, legacyEditorContent, clearLegacyEditor } from "$lib/fileStorage";

const MAX_RESULTS_PER_FILE = 10;

export type State = "PLANNING" | "QUEUED" | "RUNNING" | "FINISHED" | "FAILED";

const COMPLETED_STATES: Set<State> = new Set(["FINISHED", "FAILED"]);

/**
 * The result of one statement execution. The editor plants a hidden Monaco
 * decoration on the statement's range at run time (`anchorId`); decorations
 * track the text through edits, so the result stays associated with "its"
 * statement even after the statement is changed. Re-running replaces the
 * result (see `SqlFile.addResult`).
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
  data?: QueryData[] = $state.raw();
  stats?: QueryStats = $state.raw();
  warnings?: string[] = $state.raw();
  error?: QueryError = $state.raw();

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

export class SqlFile {
  id: string;
  name: string = $state("");
  content: string = $state("");
  results: Result[] = $state([]);
  activeResult: Result | null = $state.raw(null);

  constructor(id: string, name: string, content: string = "") {
    this.id = id;
    this.name = name;
    this.content = content;
  }

  addResult(result: Result, replacesId?: string) {
    if (replacesId) {
      const index = this.results.findIndex((r) => r.id === replacesId);
      if (index !== -1) this.results.splice(index, 1);
    }
    this.results.unshift(result);
    while (this.results.length > MAX_RESULTS_PER_FILE) {
      // Prefer evicting detached results (statement erased, not pasted back)
      // over live ones. `results` is newest-first, so scan from the tail.
      let oldestDetached = -1;
      for (let i = this.results.length - 1; i > 0; i--) {
        if (!this.results[i].anchorId) {
          oldestDetached = i;
          break;
        }
      }
      this.results.splice(oldestDetached !== -1 ? oldestDetached : this.results.length - 1, 1);
    }
    this.activeResult = result;
  }

  /**
   * Detaches results whose statement was erased (the editor reports their
   * tracked range collapsed): the result becomes invisible and cannot match
   * by anchor, but stays in the list so pasting the same statement text back
   * can reattach it (exact text match in the editor). Detached results carry
   * an empty `anchorId` and are evicted first.
   */
  detachResults(dead: Result[]) {
    for (const result of dead) {
      result.anchorId = "";
    }
    if (this.activeResult && dead.some((r) => r.id === this.activeResult?.id)) {
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
  connectionId: string = $state("");
  client: Trino = $state.raw(null!);
  catalog: CatalogCache = $state.raw(null!);

  files: SqlFile[] = $state([]);
  activeFile: SqlFile | null = $state.raw(null);

  constructor(connectionId: string, id: string = "default") {
    this.id = id;
    this.connectionId = connectionId;
    this.client = this.#createClient(connectionId);
    this.catalog = new CatalogCache(this.client);
    this.#restoreFiles();
  }

  #createClient(connectionId: string): Trino {
    return Trino.create({ server: `/api/trino/${connectionId}` });
  }

  setConnection(connectionId: string) {
    this.connectionId = connectionId;
    this.client = this.#createClient(connectionId);
    this.catalog = new CatalogCache(this.client);
  }

  #restoreFiles() {
    const stored = loadFiles(this.id);
    if (stored.files.length > 0) {
      this.files = stored.files.map((f) => new SqlFile(f.id, f.name, f.content));
    } else {
      const legacy = legacyEditorContent(this.id);
      this.files = [new SqlFile(crypto.randomUUID(), "scratch.sql", legacy ?? "")];
      if (legacy != null) clearLegacyEditor(this.id);
    }
    this.activeFile = this.files.find((f) => f.id === stored.activeFileId) ?? this.files[0];
  }

  persist() {
    saveFiles(
      this.id,
      this.files.map((f) => ({ id: f.id, name: f.name, content: f.content })),
      this.activeFile?.id
    );
  }

  openFile(file: SqlFile) {
    this.activeFile = file;
  }

  createFile() {
    const names = new Set(this.files.map((f) => f.name));
    let n = 1;
    while (names.has(`query-${n}.sql`)) n++;
    const file = new SqlFile(crypto.randomUUID(), `query-${n}.sql`);
    this.files.unshift(file);
    this.activeFile = file;
    this.persist();
    return file;
  }

  deleteFile(file: SqlFile) {
    const index = this.files.indexOf(file);
    if (index === -1) return;
    this.files.splice(index, 1);
    if (this.files.length === 0) {
      this.files.push(new SqlFile(crypto.randomUUID(), "scratch.sql"));
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
    const result = new Result(this.#createClient(this.connectionId), sql, startLine, anchorId);
    file.addResult(result, replacesId);
    void result.execute();
  }

  showResult(result: Result) {
    this.activeFile?.showResult(result);
  }
}
