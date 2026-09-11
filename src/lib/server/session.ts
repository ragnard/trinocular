import type { Handle } from "@sveltejs/kit";
import { EncryptedCookie } from "./EncryptedCookie";

import { type CookieSerializeOptions } from "cookie";

import { logger } from "./logging";

export type SessionID = string;
export type SessionData = Record<string, unknown>;

export interface SessionOptions {
  cookieName: string;
  cookieSecret: string;
  cookieOptions: CookieSerializeOptions & { path: string };
  maxLifetimeSeconds: number;
}

export interface SessionStore {
  load(sessionId: SessionID): Promise<SessionData | null>;
  save(sessionId: SessionID, data: SessionData, ttlSeconds: number): Promise<void>;
  destroy(sessionId: SessionID): Promise<void>;
  dispose?(): Promise<void>;
}

export class Session {
  #store: SessionStore;
  #sessionId: SessionID;
  #previousSessionId: SessionID | null = null;
  #data: SessionData | null = null;
  #loadPromise: Promise<void> | null = null;
  #dirty = false;
  #destroyed = false;
  #maxLifetimeSeconds: number;

  constructor(store: SessionStore, sessionId: SessionID, maxLifetimeSeconds: number) {
    this.#store = store;
    this.#sessionId = sessionId;
    this.#maxLifetimeSeconds = maxLifetimeSeconds;
  }

  get sessionId(): SessionID {
    return this.#sessionId;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  #ensureLoaded(): Promise<void> {
    if (this.#data !== null) return Promise.resolve();
    if (!this.#loadPromise) {
      this.#loadPromise = this.#store.load(this.#sessionId).then((data) => {
        this.#data = data ?? {};
      });
    }
    return this.#loadPromise;
  }

  async get<T>(key: string): Promise<T | undefined> {
    await this.#ensureLoaded();
    return this.#data![key] as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<T> {
    await this.#ensureLoaded();
    this.#data![key] = value;
    this.#dirty = true;
    return value;
  }

  async take<T>(key: string): Promise<T | undefined> {
    await this.#ensureLoaded();
    const value = this.#data![key] as T | undefined;
    if (value !== undefined) {
      delete this.#data![key];
      this.#dirty = true;
    }
    return value;
  }

  rotate(): void {
    if (!this.#previousSessionId) {
      this.#previousSessionId = this.#sessionId;
    }
    this.#sessionId = crypto.randomUUID();
  }

  async destroy(): Promise<void> {
    await this.#store.destroy(this.#sessionId);
    if (this.#previousSessionId) {
      await this.#store.destroy(this.#previousSessionId);
    }
    this.#data = {};
    this.#dirty = false;
    this.#destroyed = true;
  }

  async commit(): Promise<void> {
    if (this.#destroyed) return;
    if (!this.#dirty && !this.#previousSessionId) return;

    if (this.#data !== null) {
      await this.#store.save(this.#sessionId, this.#data, this.#maxLifetimeSeconds);
    }

    if (this.#previousSessionId) {
      await this.#store.destroy(this.#previousSessionId);
    }
  }
}

interface StoreEntry {
  data: SessionData;
  expiresAt: number;
}

export class InMemoryStore implements SessionStore {
  #sessions = new Map<SessionID, StoreEntry>();
  #sweepInterval: ReturnType<typeof setInterval>;

  constructor(sweepIntervalMs: number = 60_000) {
    this.#sweepInterval = setInterval(() => this.#sweep(), sweepIntervalMs);
    if (this.#sweepInterval.unref) this.#sweepInterval.unref();
  }

  async load(sessionId: SessionID): Promise<SessionData | null> {
    const entry = this.#sessions.get(sessionId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.#sessions.delete(sessionId);
      return null;
    }
    return { ...entry.data };
  }

  async save(sessionId: SessionID, data: SessionData, ttlSeconds: number): Promise<void> {
    this.#sessions.set(sessionId, {
      data: { ...data },
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async destroy(sessionId: SessionID): Promise<void> {
    this.#sessions.delete(sessionId);
  }

  #sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.#sessions) {
      if (now > entry.expiresAt) {
        this.#sessions.delete(id);
      }
    }
  }

  async dispose(): Promise<void> {
    clearInterval(this.#sweepInterval);
  }
}

type HandlerFactory = (store: SessionStore, opts: SessionOptions) => Promise<Handle>;

export const SessionHandler: HandlerFactory = async (store, opts) => {
  const cookie = await EncryptedCookie.create(opts.cookieName, opts.cookieSecret);

  return async ({ event, resolve }) => {
    let sessionId: string | null = null;
    try {
      sessionId = await cookie.getValue(event);
    } catch {
      logger.warn("failed to decrypt session cookie, issuing new session");
    }
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      await cookie.setValue(event, sessionId, opts.cookieOptions);
    }

    const session = new Session(store, sessionId, opts.maxLifetimeSeconds);
    event.locals.session = session;

    let res: Response;
    try {
      res = await resolve(event);
    } finally {
      try {
        await session.commit();
      } catch (e) {
        logger.error({ error: e }, "failed to commit session");
      }

      if (session.destroyed) {
        event.cookies.delete(opts.cookieName, { path: opts.cookieOptions.path });
      } else if (session.sessionId !== sessionId) {
        await cookie.setValue(event, session.sessionId, opts.cookieOptions);
      }
    }

    return res;
  };
};
