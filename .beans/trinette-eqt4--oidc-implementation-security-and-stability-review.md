---
# trinette-eqt4
title: OIDC implementation security and stability review
status: completed
type: epic
priority: normal
created_at: 2026-04-03T11:53:37Z
updated_at: 2026-04-03T16:44:54Z
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

## Summary of Changes

All identified security and stability issues have been addressed:
- Session rotation now correctly cleans up old session data (SessionStore redesign)
- Server-side session expiration with configurable TTL and periodic sweep
- Proactive token refresh is now awaited instead of fire-and-forget
- Cookie secret minimum length enforcement
- Session IDs truncated in logs
- Proxy error responses sanitized
- Logout and session revocation implemented

A final security review found no additional exploitable issues. Trino's own auth model covers header-level concerns, and SvelteKit's built-in CSRF protection covers cross-origin attacks.
