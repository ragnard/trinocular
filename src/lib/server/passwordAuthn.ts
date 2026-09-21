import { redirect, type Handle } from "@sveltejs/kit";
import { createHash, timingSafeEqual } from "node:crypto";

import type { Claims } from "./identity";
import type { Session } from "./session";

/**
 * `authn: password`: a list of users written in the config, signed in through
 * a form and kept in the session the way an OIDC login is.
 *
 * It is a form and a session, and not HTTP Basic, because the browser dialog
 * kind cannot be signed out of — a browser re-sends the credentials for the
 * life of the window, which would make the `Sign out` in the account menu a
 * lie — and would have the password checked on every request or a session
 * issued anyway. The form is the existing `/auth/login` page; the page's
 * action does the check and writes the session, and this handler reads it.
 */

export interface PasswordUser {
  password: string;
  claims: Claims;
}

export type PasswordUsers = Record<string, PasswordUser>;

/** The session key, and what is under it: the user id and nothing else. The
 *  claims are read from the config on every request, so editing a user's
 *  claims or removing the user takes effect on their next request rather than
 *  when their session happens to expire. */
export const SESSION_KEY = "password";

export interface PasswordSessionData {
  userId: string;
}

/** Bytes of a fixed length whatever the input, so that `timingSafeEqual` has
 *  equal lengths to compare and the comparison says nothing about how long
 *  the right answer is. */
const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

// What an unknown name is compared against, so that "no such user" costs the
// same as "wrong password" and the timing does not say which it was.
const DUMMY = digest("");

/** The user id the credentials name, or nothing. */
export const authenticate = (
  users: PasswordUsers,
  username: string,
  password: string
): string | undefined => {
  const user = Object.hasOwn(users, username) ? users[username] : undefined;
  const expected = user ? digest(user.password) : DUMMY;
  const matched = timingSafeEqual(digest(password), expected);
  return user && matched ? username : undefined;
};

/** The most a throttled name waits between attempts, in seconds. A brake and
 *  not a lock: it is per process, so a second replica does not see the
 *  failures the first one counted, and it is per *name*, so anyone can slow a
 *  name down by guessing at it — which at this cap is a nuisance rather than
 *  a way to keep the owner out. */
export const MAX_DELAY_SECONDS = 30;

/** Failures a name gets before the delays start. */
export const FREE_FAILURES = 5;

/** How long a name has to go untried before its failures are forgotten. Long
 *  enough that taking the free failures, waiting, and taking them again is
 *  slower than the delays it is trying to sidestep. */
export const FORGET_MS = 10 * 60 * 1000;

/**
 * A comparison of two digests costs microseconds, which is no brake at all on
 * guessing over the network; this is one. After `FREE_FAILURES` consecutive
 * failures a name has to wait before its next attempt is even checked, and
 * the wait doubles with each failure up to `MAX_DELAY_SECONDS`. A success
 * clears the name.
 */
export class LoginThrottle {
  #failures = new Map<string, { count: number; last: number; notBefore: number }>();
  #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** Whether an attempt on this name may be checked right now. */
  allows(username: string): boolean {
    this.#prune();
    const entry = this.#failures.get(username);
    return !entry || this.#now() >= entry.notBefore;
  }

  failed(username: string): void {
    const now = this.#now();
    const count = (this.#failures.get(username)?.count ?? 0) + 1;
    const over = count - FREE_FAILURES;
    const delay = over > 0 ? Math.min(2 ** (over - 1), MAX_DELAY_SECONDS) : 0;
    this.#failures.set(username, { count, last: now, notBefore: now + delay * 1000 });
  }

  succeeded(username: string): void {
    this.#failures.delete(username);
  }

  /** A name not tried for `FORGET_MS` is forgotten, which is also what keeps
   *  the map from growing with every name ever guessed. */
  #prune(): void {
    const now = this.#now();
    for (const [name, entry] of this.#failures) {
      if (now - entry.last >= FORGET_MS) this.#failures.delete(name);
    }
  }
}

interface PasswordAuthnOptions {
  users: PasswordUsers;
  /** Where `Sign out` posts. Answered here, as the OIDC handler answers its
   *  own, so that the route tree does not grow a logout that means something
   *  different under each mechanism. */
  logoutPath: string;
}

export const PasswordAuthnHandler = (opts: PasswordAuthnOptions): Handle => {
  return async ({ event, resolve }) => {
    const session: Session = event.locals.session;

    if (event.url.pathname === opts.logoutPath && event.request.method === "POST") {
      await session.destroy();
      redirect(303, "/");
    }

    const data = await session.get<PasswordSessionData>(SESSION_KEY);
    if (data) {
      const user = Object.hasOwn(opts.users, data.userId) ? opts.users[data.userId] : undefined;
      if (user) {
        event.locals.identity = { userId: data.userId, claims: user.claims };
      } else {
        // Removed from the config since they signed in: the session is
        // nobody's now, and the gate sends them to the login page.
        event.locals.logger.warn(
          { userId: data.userId },
          "session names a user the config no longer has"
        );
        await session.take(SESSION_KEY);
      }
    }

    return await resolve(event);
  };
};
