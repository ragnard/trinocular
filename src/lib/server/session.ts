import type { Handle } from "@sveltejs/kit";
import { EncryptedCookie } from "./EncryptedCookie";

import { type CookieSerializeOptions } from "cookie";

import { logger } from "./logging";

export type SessionID = string;

export interface SessionOptions {
  cookieName: string;
  cookieSecret: string;
  cookieOptions: CookieSerializeOptions & { path: string };
}

export class Session {
  #store: SessionStore;
  #sessionId: SessionID;
  #destroyed = false;

  constructor(store: SessionStore, sessionId: SessionID) {
    this.#store = store;
    this.#sessionId = sessionId;
  }

  get sessionId(): SessionID {
    return this.#sessionId;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  rotate(): void {
    this.#sessionId = crypto.randomUUID();
  }

  async destroy(): Promise<void> {
    await this.#store.destroy(this.#sessionId);
    this.#destroyed = true;
  }

  async set<T>(key: string, value: T): Promise<T> {
    await this.#store.set(this.#sessionId, key, value);
    return value;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.#store.get(this.#sessionId, key);
  }

  async take<T>(key: string): Promise<T | undefined> {
    return this.#store.take(this.#sessionId, key);
  }
}

export interface SessionStore {
  set<T>(sessionId: SessionID, key: string, value: T): Promise<T>;
  get<T>(sessionId: SessionID, key: string): Promise<T | undefined>;
  take<T>(sessionId: SessionID, key: string): Promise<T | undefined>;
  destroy(sessionId: SessionID): Promise<void>;
}

export class InMemoryStore implements SessionStore {
  #sessions: Map<SessionID, Map<string, any>>;

  constructor() {
    this.#sessions = new Map();
  }

  async set<T>(sessionId: SessionID, key: string, value: T): Promise<T> {
    if (!this.#sessions.has(sessionId)) {
      this.#sessions.set(sessionId, new Map());
    }
    const session = this.#sessions.get(sessionId);

    session!.set(key, value);

    return value;
  }

  async get<T>(sessionId: SessionID, key: string): Promise<T | undefined> {
    const session = this.#sessions.get(sessionId);
    if (session) {
      return session.get(key) as T;
    } else {
      return;
    }
  }

  async take<T>(sessionId: SessionID, key: string): Promise<T | undefined> {
    const session = this.#sessions.get(sessionId);
    if (session) {
      const value = session.get(key);
      if (value) {
        session.delete(key);
        return value as T;
      }
    }
  }

  async destroy(sessionId: SessionID): Promise<void> {
    this.#sessions.delete(sessionId);
  }
}

type HandlerFactory = (store: SessionStore, opts: SessionOptions) => Promise<Handle>;

export const SessionHandler: HandlerFactory = async (store, opts) => {
  const cookieKey = await EncryptedCookie.createKey(opts.cookieSecret, opts.cookieName);
  const cookie = new EncryptedCookie(opts.cookieName, cookieKey);

  return async ({ event, resolve }) => {
    // get or create sessionId from encrypted cookie
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

    // get or create session
    const session = new Session(store, sessionId);
    // event.locals.logger.debug("session");

    event.locals.session = session;

    let res: Response;
    try {
      res = await resolve(event);
    } finally {
      if (session.destroyed) {
        event.cookies.delete(opts.cookieName, { path: opts.cookieOptions.path });
      } else if (session.sessionId !== sessionId) {
        await cookie.setValue(event, session.sessionId, opts.cookieOptions);
      }
    }

    return res;
  };
};
