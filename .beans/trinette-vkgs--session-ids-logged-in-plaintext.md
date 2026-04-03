---
# trinette-vkgs
title: Session IDs logged in plaintext
status: completed
type: task
priority: normal
created_at: 2026-04-03T11:56:53Z
updated_at: 2026-04-03T12:46:38Z
parent: trinette-eqt4
---

## Problem

In \`src/lib/server/oidc.ts:100,104\`, the \`TokenRefreshCoalescer\` logs session IDs in plaintext:

\`\`\`typescript
this.#log.info({ sessionId: session.sessionId }, "refreshing token");
this.#log.info({ sessionId: session.sessionId }, "token refreshed");
\`\`\`

Session IDs are the keys used to look up session data in the server-side store. If logs are compromised (shipped to a log aggregator, stored on disk, exposed via misconfiguration), an attacker with access to both the logs and the session store could use these IDs to access session data directly, bypassing cookie encryption.

## Security impact

- Information disclosure: session identifiers are sensitive credentials.
- Violates principle of least privilege for log consumers.

## Suggested fix

Either:
1. Remove session IDs from log output entirely, or
2. Log a truncated/hashed version (e.g., first 8 chars or a SHA-256 prefix) sufficient for correlation without being directly usable.

## Files
- `src/lib/server/oidc.ts:100,104`

## Summary of Changes\n\nTruncated session IDs to first 8 characters in log output at `src/lib/server/oidc.ts:100,104`. Logs remain useful for correlation but are no longer directly exploitable for session hijacking.
