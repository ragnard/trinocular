// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Logger } from "pino";
import type { Session } from "$lib/server/session";
import type { Identity } from "$lib/server/identity";
import type { Branding } from "$lib/server/config";
import type { ClientConnection } from "$lib/server/connectionAuthz";

declare global {
  namespace App {
    interface Error {
      message: string;
      /** Ties what the user was shown to the line in the log. */
      requestId?: string;
    }
    interface Locals {
      logger: Logger;
      requestId: string;
      session: Session;
      /** Set by the authn handler; absent means nobody is signed in. */
      identity: Identity | undefined;
      accessToken: string;
    }
    /** What the root layout's load hands every page; see +layout.server.ts. */
    interface PageData {
      branding: Branding;
      connections: ClientConnection[];
      userId?: string;
      logoutPath?: string;
    }
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
