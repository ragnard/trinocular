---
# trinette-g7ou
title: No minimum entropy enforcement on cookieSecret
status: todo
type: bug
created_at: 2026-04-03T11:56:47Z
updated_at: 2026-04-03T11:56:47Z
parent: trinette-eqt4
---

## Problem

In \`src/lib/server/config.ts:26\`, \`cookieSecret\` is validated only as \`z.string()\`:

\`\`\`typescript
cookieSecret: z.string(),
\`\`\`

This accepts any string, including empty strings or very short values like \`"a"\`. Since this secret is the sole input key material for HKDF key derivation (\`EncryptedCookie.createKey\`), a weak secret means the session cookie encryption is trivially breakable.

An attacker who can guess the cookie secret can:
- Decrypt session cookies to extract session IDs
- Forge session cookies to hijack any session

## Suggested fix

Add a minimum length constraint (e.g., 32 characters) and document that the secret should be generated with a CSPRNG:

\`\`\`typescript
cookieSecret: z.string().min(32, "cookieSecret must be at least 32 characters for adequate security"),
\`\`\`

The default config already generates a 32-char random secret (\`crypto.randomUUID().replace(/-/g, "")\`), so this just prevents users from configuring a weak one.

## Files
- `src/lib/server/config.ts:26` — SessionSchema
