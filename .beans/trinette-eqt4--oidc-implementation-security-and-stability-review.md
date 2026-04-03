---
# trinette-eqt4
title: OIDC implementation security and stability review
status: in-progress
type: epic
priority: normal
created_at: 2026-04-03T11:53:37Z
updated_at: 2026-04-03T12:15:04Z
---

Thorough review of the OIDC authentication implementation to identify security vulnerabilities and stability issues.


## Findings

### Security issues
1. **No logout endpoint** (trinette-4yfm) — Users cannot sign out or revoke sessions
2. **No session expiration** (trinette-7lrf) — Sessions live forever with no TTL or idle timeout
3. **Weak cookieSecret allowed** (trinette-g7ou) — Config accepts any string, even empty
4. **Session IDs in logs** (trinette-vkgs) — Plaintext session IDs in log output
5. **Error info disclosure** (trinette-vt4p) — Proxy errors leak internal hostnames/IPs

### Stability issues
6. **Session rotation memory leak** (trinette-g7hf) — `rotate()` orphans old session data
7. **Proactive refresh silent failures** (trinette-vqje) — Fire-and-forget refresh can lose refresh tokens with rotating providers

### Positives noted
- PKCE with S256 correctly implemented
- State and nonce validated via openid-client library
- Open redirect protection on return URL (`isSafeReturnUrl`)
- Session fixation mitigated via `session.rotate()` on callback
- Access token stays server-side (not exposed to client)
- OIDC callback data cleaned up with `take()` (use-once)
- Cookie encryption uses AES-GCM with HKDF key derivation and AAD
- Token refresh coalescing prevents redundant refresh requests
- SvelteKit's built-in CSRF protection covers proxy endpoints
