---
# trinette-vt4p
title: Proxy error responses may leak internal infrastructure details
status: completed
type: bug
priority: normal
created_at: 2026-04-03T11:57:00Z
updated_at: 2026-04-03T13:11:26Z
parent: trinette-eqt4
---

## Problem

In \`src/routes/api/trino/[id]/[...path]/+server.ts:86\`, the proxy error message includes the raw upstream error:

\`\`\`typescript
error(502, \`Failed to connect to upstream Trino server: \${err instanceof Error ? err.message : err}\`);
\`\`\`

Upstream error messages can contain internal hostnames, IP addresses, port numbers, and other infrastructure details (e.g., \`ECONNREFUSED 10.0.1.42:8080\`, DNS resolution failures with internal domain names).

Similarly, on line 14:
\`\`\`typescript
error(400, \`Invalid Trino API path: \${path}\`);
\`\`\`
This reflects user input back in the error, though SvelteKit should escape it.

## Security impact

- Information disclosure of internal network topology to end users.
- Aids attackers in mapping internal infrastructure.

## Suggested fix

Log the full error server-side (already done on line 85), but return a generic message to the client:

\`\`\`typescript
error(502, "Failed to connect to upstream Trino server");
\`\`\`

## Files
- `src/routes/api/trino/[id]/[...path]/+server.ts:86,14`

## Summary of Changes\n\nCreated `src/lib/server/errors.ts` with a `serverError(logger, status, clientMessage, logMessage, context?)` wrapper that logs detailed context server-side and returns a safe generic message to the client.\n\nReplaced 3 `error()` calls in the Trino proxy (`+server.ts`) and 1 in OIDC handler (`oidc.ts`) with `serverError()`. Internal hostnames, error messages, and token data are no longer exposed to clients.
