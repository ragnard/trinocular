---
# trinette-7lrf
title: No server-side session expiration or cleanup
status: todo
type: bug
created_at: 2026-04-03T11:56:34Z
updated_at: 2026-04-03T11:56:34Z
parent: trinette-eqt4
---

## Problem

The `SessionStore` interface has no concept of TTL, idle timeout, or eviction. Sessions accumulate indefinitely:

- **No absolute session lifetime**: A session created at login is valid forever as long as the OIDC tokens can be refreshed. There is no maximum session duration to force re-authentication.
- **No idle timeout**: Sessions that haven't been accessed in days/weeks remain valid.
- **No eviction mechanism**: The store grows without bound. Orphaned sessions (from rotation, abandoned auth flows, etc.) are never cleaned up.

The session cookie also has no `maxAge` by default (`src/hooks.server.ts:49`), making it a browser-session cookie with no server-enforced expiry.

## Security impact

- Long-lived sessions increase the window for session hijacking.
- No forced re-authentication means a compromised refresh token provides indefinite access.
- Unbounded session store growth will eventually exhaust server memory (stability).

## Suggested fix

1. Add TTL support to the `SessionStore` interface (e.g., `set()` accepts a TTL, store auto-evicts expired entries).
2. Enforce an absolute session lifetime (e.g., 8-24 hours) independent of token expiry.
3. Add idle timeout support (e.g., extend TTL on each access, but cap at absolute lifetime).
4. Consider requiring a `maxAge` on the session cookie config to match server-side lifetime.

## Files
- `src/lib/server/session.ts` — `SessionStore` interface, `Session` class
- `src/hooks.server.ts` — cookie options
- `src/lib/server/config.ts` — add session lifetime config options
