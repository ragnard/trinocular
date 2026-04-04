---
# trinette-7lrf
title: No server-side session expiration or cleanup
status: completed
type: bug
priority: normal
created_at: 2026-04-03T11:56:34Z
updated_at: 2026-04-03T14:54:30Z
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

## Summary of Changes

Resolved by the SessionStore redesign. The `SessionStore` interface now accepts a `ttlSeconds` parameter on `save()`. `InMemoryStore` tracks expiry timestamps per session and runs a periodic sweep (default 60s) to evict expired entries. `maxLifetimeSeconds` is configurable in the session config (default 24h), acting as a sliding window renewed on each request.
