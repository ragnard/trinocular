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
  readonly sessionId: SessionID;

  constructor(store: SessionStore, sessionId: SessionID) {
    this.#store = store;
    this.sessionId = sessionId;
  }

  async set<T>(key: string, value: T): Promise<T> {
    this.#store.set(this.sessionId, key, value);
    return value;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.#store.get(this.sessionId, key);
  }

  async take<T>(key: string): Promise<T | undefined> {
    return this.#store.take(this.sessionId, key);
  }
}

export interface SessionStore {
  set<T>(sessionId: SessionID, key: string, value: T): Promise<T>;
  get<T>(sessionId: SessionID, key: string): Promise<T | undefined>;
  take<T>(sessionId: SessionID, key: string): Promise<T | undefined>;

  // getOrCreate(sessionId: string, fn: () => Map<string, any>): Promise<Session>;
  // save(sessionId: string, session: Session): Promise<void>;
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
}

type HandlerFactory = (store: SessionStore, opts: SessionOptions) => Promise<Handle>;

export const SessionHandler: HandlerFactory = async (store, opts) => {
  const cookieKey = await EncryptedCookie.createKey(opts.cookieSecret);
  const cookie = new EncryptedCookie(opts.cookieName, cookieKey);

  return async ({ event, resolve }) => {
    // get or create sessionId from encrypted cookie
    let sessionId = await cookie.getValue(event);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      await cookie.setValue(event, sessionId, opts.cookieOptions);
    }

    // get or create session
    const session = new Session(store, sessionId);
    // event.locals.logger.debug("session");

    event.locals.session = session;

    const res = await resolve(event);

    return res;
  };
};
