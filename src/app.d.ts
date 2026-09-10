// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Logger } from "pino";
import type { Session } from "$lib/server/session";
import type { Identity } from "$lib/server/identity";

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
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

}

export {};
