---
# trinette-vt4p
title: Proxy error responses may leak internal infrastructure details
status: todo
type: bug
created_at: 2026-04-03T11:57:00Z
updated_at: 2026-04-03T11:57:00Z
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
