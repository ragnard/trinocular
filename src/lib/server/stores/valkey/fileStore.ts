import {
  toStoredFile,
  toStoredUi,
  type FileRecord,
  type StoredFile,
  type StoredUi
} from "../../../workspaceRecord";

import type { ValkeyFileStoreConfig } from "../../config";
import type { FileStore, PutResult } from "../../fileStore";
import { openClient, type Client, type Log } from "./client";

/**
 * The compare-and-set, on the server so the read and the write are one step.
 * KEYS: the user's hash of documents, the counter their versions come from.
 * ARGV: file id, expected version ("" for none), the record. A field holds
 * `version\n{record}`, so the version is a string search and the document is
 * never parsed here. A miss is `false` in Lua, which travels as a null
 * element; a nil would end the array instead.
 */
const PUT = `
local current = redis.call('HGET', KEYS[1], ARGV[1])
local version = ''
if current then version = string.sub(current, 1, string.find(current, '\\n', 1, true) - 1) end
if version ~= ARGV[2] then return {'conflict', current} end
local next = redis.call('INCR', KEYS[2])
redis.call('HSET', KEYS[1], ARGV[1], next .. '\\n' .. ARGV[3])
return {'saved', tostring(next)}
`;

type PutReply = ["saved", string] | ["conflict", string | null];

interface Commands {
  trinetteFilePut(
    files: string,
    seq: string,
    id: string,
    expected: string,
    record: string
  ): Promise<PutReply>;
}

/**
 * A user's documents are the fields of one hash, beside a version counter and
 * the ui record, all under a hash tag of the user id so cluster mode keeps
 * them in one slot and the script can see both keys. Versions come from the
 * counter and not the document, so a document removed and made again never
 * repeats one. Not sealed, like the sqlite store.
 */
export class ValkeyFileStore implements FileStore {
  #client: Client & Commands;
  #prefix: string;
  #log: Log;

  private constructor(client: Client, prefix: string, log: Log) {
    client.defineCommand("trinetteFilePut", { numberOfKeys: 2, lua: PUT });
    this.#client = client as Client & Commands;
    this.#prefix = prefix;
    this.#log = log;
  }

  static async create(cfg: ValkeyFileStoreConfig, log: Log): Promise<ValkeyFileStore> {
    return new ValkeyFileStore(await openClient(cfg, log), cfg.keyPrefix, log);
  }

  #keys(userId: string) {
    const files = `${this.#prefix}{${userId}}`;
    return { files, seq: `${files}:seq`, ui: `${files}:ui` };
  }

  #parse(userId: string, fileId: string, field: string | null | undefined): FileRecord | null {
    if (field == null) return null;
    const cut = field.indexOf("\n");
    try {
      const file = toStoredFile(JSON.parse(field.slice(cut + 1)));
      if (cut > 0 && file) return { ...file, version: field.slice(0, cut) };
    } catch {}
    this.#log.warn({ userId, fileId }, "unreadable file record, skipping");
    return null;
  }

  async list(userId: string) {
    const keys = this.#keys(userId);
    const [fields, ui] = await Promise.all([
      this.#client.hgetall(keys.files),
      this.#client.get(keys.ui)
    ]);
    const files: FileRecord[] = [];
    for (const [id, field] of Object.entries(fields)) {
      const file = this.#parse(userId, id, field);
      if (file) files.push(file);
    }
    let parsedUi: StoredUi | null = null;
    if (ui !== null) {
      try {
        parsedUi = toStoredUi(JSON.parse(ui));
      } catch {}
    }
    return { files, ui: parsedUi };
  }

  async put(userId: string, file: StoredFile, expected: string | null): Promise<PutResult> {
    const keys = this.#keys(userId);
    const reply = await this.#client.trinetteFilePut(
      keys.files,
      keys.seq,
      file.id,
      expected ?? "",
      JSON.stringify(file)
    );
    if (reply[0] === "saved") return { status: "saved", version: reply[1] };
    return { status: "conflict", current: this.#parse(userId, file.id, reply[1]) };
  }

  async remove(userId: string, fileId: string): Promise<void> {
    await this.#client.hdel(this.#keys(userId).files, fileId);
  }

  async putUi(userId: string, ui: StoredUi): Promise<void> {
    await this.#client.set(this.#keys(userId).ui, JSON.stringify(ui));
  }

  async ping(): Promise<void> {
    await this.#client.ping();
  }

  async dispose(): Promise<void> {
    await this.#client.quit();
  }
}
