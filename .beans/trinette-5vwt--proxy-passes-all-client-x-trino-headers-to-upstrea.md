---
# trinette-5vwt
title: Proxy passes all client X-Trino-* headers to upstream without filtering
status: scrapped
type: bug
priority: high
created_at: 2026-04-03T14:58:33Z
updated_at: 2026-04-03T16:42:49Z
parent: trinette-eqt4
---

The proxy in src/routes/api/trino/[id]/[...path]/+server.ts copies all X-Trino-* headers from the client request to upstream Trino (lines 42-45), only overriding X-Trino-User. An authenticated user can inject dangerous headers like X-Trino-Extra-Credential (to authenticate as a different user to connectors) or X-Trino-Set-Role (to escalate authorization roles). The proxy should use an allowlist of safe headers (catalog, schema, prepared statement, session properties) rather than passing everything through.

## Reasons for Scrapping

Not a real vulnerability. Trino's own authentication and authorization model handles all of these headers server-side:
- X-Trino-User: impersonation checks enforced when auth is enabled
- X-Trino-Extra-Credential: validated by connectors against their own allowlists
- X-Trino-Set-Role: validated against the authenticated user's granted roles

Filtering these in the proxy would break functionality without adding security.
