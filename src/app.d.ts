// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Logger } from "pino";
import type { Session } from "$lib/server/session";
import type { IDToken } from "openid-client";

declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      logger: Logger;
      requestId: string;
      session: Session;
      userId: string;
      accessToken: string;
      claims: IDToken | undefined;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

}

export {};
