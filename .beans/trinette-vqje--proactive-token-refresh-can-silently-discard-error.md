---
# trinette-vqje
title: Proactive token refresh can silently discard errors without re-auth
status: completed
type: bug
priority: normal
created_at: 2026-04-03T11:57:09Z
updated_at: 2026-04-03T14:54:32Z
parent: trinette-eqt4
---

## Problem

In \`src/lib/server/oidc.ts:221-225\`, the proactive (near-expiry) token refresh is fire-and-forget:

\`\`\`typescript
} else if (nearExpiry(oidcData.accessTokenExpiresAt, 30) && oidcData.refreshToken) {
  coalescer.refresh(session, oidcData).catch((e) => {
    event.locals.logger.warn({ error: e }, "proactive refresh failed");
  });
}
\`\`\`

If the proactive refresh fails (e.g., refresh token revoked by the provider, provider is down), the failure is only logged. The current request proceeds with the still-valid-but-soon-expiring token. The next request will find the token expired and attempt a full refresh, which will also fail, causing a redirect to the provider.

The subtle issue: if the refresh token was **rotated** by the provider during a successful proactive refresh, and the write to the session store fails or races with another request reading stale data, the old refresh token (now revoked) may be used on the next attempt, causing an unnecessary re-authentication.

## Impact

- **Silent failure**: Proactive refresh failures are not surfaced, making debugging token issues harder.
- **Refresh token rotation race**: With providers that do refresh token rotation, a failed write-back could invalidate the session's refresh capability.

## Suggested fix

1. If proactive refresh fails with a non-transient error (e.g., \`invalid_grant\`), mark the session as requiring re-authentication on the next request rather than silently continuing.
2. Consider adding a retry or fallback for transient errors.

## Files
- `src/lib/server/oidc.ts:221-225`

## Summary of Changes

The proactive token refresh is now awaited instead of fire-and-forget. This ensures the refreshed token is written to the in-memory session cache before `commit()` persists it, eliminating the race where a fire-and-forget refresh could complete after the session was already committed.
