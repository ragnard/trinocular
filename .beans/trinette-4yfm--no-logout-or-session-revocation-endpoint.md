---
# trinette-4yfm
title: No logout or session revocation endpoint
status: completed
type: task
priority: normal
created_at: 2026-04-03T11:56:25Z
updated_at: 2026-04-03T12:56:06Z
parent: trinette-eqt4
---

## Problem

There is no logout endpoint anywhere in the application. Once authenticated, a user has no way to:
- Clear their server-side session
- Revoke their tokens at the OIDC provider (RP-initiated logout)
- End their session from the browser

The only way to "log out" is to wait for the access token to expire and the refresh token to stop working, or clear cookies manually.

## Security impact

- **Shared/public computers**: A user cannot sign out, leaving their session accessible to the next person.
- **Compromised sessions**: No mechanism to invalidate a stolen session.
- **Compliance**: Many security standards (SOC2, OWASP) require logout functionality.

## Suggested fix

Add a `/auth/logout` endpoint that:
1. Clears the session data from the store
2. Clears the session cookie
3. Optionally initiates RP-initiated logout at the OIDC provider (`end_session_endpoint`) to also end the IdP session

## Files
- `src/lib/server/oidc.ts` — add logout route handling
- `src/lib/server/session.ts` — add `destroy()` method to `Session` and `SessionStore`

## Summary of Changes\n\nAdded `POST /auth/logout` endpoint:\n\n- **`src/lib/server/session.ts`**: Added `destroy()` method to `Session`, `SessionStore` interface, and `InMemoryStore`. Session sets a `destroyed` flag so `SessionHandler` clears the cookie after resolve.\n- **`src/lib/server/oidc.ts`**: New logout route that revokes the refresh token at the OIDC provider (best-effort), destroys the server-side session, and redirects to `/`.\n- **`src/lib/server/config.ts`**: Added `logout` path to OIDC paths schema (defaults to `"logout"`).
