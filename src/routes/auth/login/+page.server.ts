import { fail, redirect } from "@sveltejs/kit";

import type { Actions, PageServerLoad } from "./$types";
import { safeReturnTo } from "$lib/server/authz";
import { config } from "$lib/server/config";
import {
  authenticate,
  LoginThrottle,
  SESSION_KEY,
  type PasswordSessionData
} from "$lib/server/passwordAuthn";

/**
 * The login form of `authn: password`. Under OIDC this page is never reached
 * — the handler answers the login path itself with a redirect to the provider
 * — and under `none` nobody is ever signed out, so the load below sends both
 * cases home rather than drawing a form that would go nowhere.
 *
 * The check and the session write are here, in the page's action rather than
 * in the authn handler, so that a wrong password re-renders the form with the
 * name kept and the error beside it: a handler would have to round-trip that
 * through a redirect and a flash in the session. Reading the session back
 * into an identity on every request is the handler's half.
 */

const users = config.authn.kind === "password" ? config.authn.users : undefined;

// One per process: the brake it applies is documented as exactly that.
const throttle = new LoginThrottle();

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.identity || !users) redirect(303, safeReturnTo(url.searchParams.get("returnTo")));
  return {};
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!users) return fail(404);

    const form = await request.formData();
    const username = String(form.get("username") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const returnTo = safeReturnTo(String(form.get("returnTo") ?? "/"));

    if (!throttle.allows(username)) {
      locals.logger.warn({ username }, "login throttled");
      return fail(429, { username, throttled: true });
    }

    const userId = authenticate(users, username, password);
    if (!userId) {
      throttle.failed(username);
      locals.logger.warn({ username }, "login failed");
      return fail(401, { username, failed: true });
    }
    throttle.succeeded(username);

    // A fresh id for the signed-in session, so an id handed out before login
    // — planted in this browser, say — names nothing once it has succeeded.
    await locals.session.rotate();
    await locals.session.set<PasswordSessionData>(SESSION_KEY, { userId });
    locals.logger.info({ userId }, "login");
    redirect(303, returnTo);
  }
};
