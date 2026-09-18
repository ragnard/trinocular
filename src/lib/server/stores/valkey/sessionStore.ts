import type { ValkeySessionStoreConfig } from "../../config";
import { Sealer } from "../../Sealer";
import type { SessionData, SessionID, SessionStore } from "../../sessionStore";
import { openClient, type Client, type Log } from "./client";

/** Sessions in Valkey (or Redis), one key per session, sealed with a key
 *  derived from the store's own secret so a dump of the store yields nothing. */
export class ValkeySessionStore implements SessionStore {
  #client: Client;
  #prefix: string;
  #sealer: Sealer;
  #log: Log;

  private constructor(client: Client, prefix: string, sealer: Sealer, log: Log) {
    this.#client = client;
    this.#prefix = prefix;
    this.#sealer = sealer;
    this.#log = log;
  }

  static async create(cfg: ValkeySessionStoreConfig, log: Log): Promise<ValkeySessionStore> {
    const sealer = await Sealer.create(cfg.secret, "SessionStore");
    const client = await openClient(cfg, log);
    return new ValkeySessionStore(client, cfg.keyPrefix, sealer, log);
  }

  #key(sessionId: SessionID): string {
    return this.#prefix + sessionId;
  }

  async load(sessionId: SessionID): Promise<SessionData | null> {
    const sealed = await this.#client.get(this.#key(sessionId));
    if (sealed === null) return null;
    try {
      return JSON.parse(await this.#sealer.open(sealed));
    } catch (err) {
      // Written under another secret, or not by us at all. Either way it is
      // not this user's session, and starting them a fresh one is the only
      // honest answer.
      this.#log.warn({ err, sessionId: sessionId.slice(0, 8) }, "unreadable session, dropping");
      await this.destroy(sessionId);
      return null;
    }
  }

  async save(sessionId: SessionID, data: SessionData, ttlSeconds: number): Promise<void> {
    const sealed = await this.#sealer.seal(JSON.stringify(data));
    await this.#client.set(this.#key(sessionId), sealed, "EX", ttlSeconds);
  }

  async destroy(sessionId: SessionID): Promise<void> {
    await this.#client.del(this.#key(sessionId));
  }

  async ping(): Promise<void> {
    await this.#client.ping();
  }

  async dispose(): Promise<void> {
    await this.#client.quit();
  }
}
