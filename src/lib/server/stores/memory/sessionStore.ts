import type { SessionData, SessionID, SessionStore } from "../../sessionStore";

interface StoreEntry {
  data: SessionData;
  expiresAt: number;
}

/** Sessions in this process, gone with it. */
export class InMemorySessionStore implements SessionStore {
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
      expiresAt: Date.now() + ttlSeconds * 1000
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
