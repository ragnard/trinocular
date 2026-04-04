---
# trinette-g7hf
title: Session rotation orphans old session data (memory leak)
status: completed
type: bug
priority: normal
created_at: 2026-04-03T11:56:40Z
updated_at: 2026-04-03T14:54:28Z
parent: trinette-eqt4
---

## Problem

In `src/lib/server/session.ts:29-31`, `Session.rotate()` generates a new session ID but never deletes the data stored under the old session ID:

\`\`\`typescript
rotate(): void {
  this.#sessionId = crypto.randomUUID();
}
\`\`\`

This is called in `src/lib/server/oidc.ts:179` after successful authentication. The OIDC handler correctly writes new data to the new session ID (line 180), but the old session's data remains in the store forever.

While \`session.take("oidc-callback")\` (line 171) removes the callback key, any other data stored under the old session ID is leaked.

## Impact

Every successful login leaks one session entry in the store. Over time this causes unbounded memory growth proportional to the number of logins.

## Suggested fix

\`Session.rotate()\` should delete all data under the old session ID before assigning the new one. This requires adding a \`delete(sessionId)\` method to the \`SessionStore\` interface:

\`\`\`typescript
rotate(): void {
  const oldId = this.#sessionId;
  this.#sessionId = crypto.randomUUID();
  this.#store.delete(oldId);  // clean up old session
}
\`\`\`

## Files
- `src/lib/server/session.ts:29-31` — `Session.rotate()`
- `src/lib/server/session.ts:47-54` — `SessionStore` interface (add `delete`)

## Summary of Changes

Resolved by the SessionStore redesign. `Session.rotate()` now records the previous session ID, and `Session.commit()` (called at end of request by `SessionHandler`) saves data under the new ID and destroys the old one. No data is orphaned.
