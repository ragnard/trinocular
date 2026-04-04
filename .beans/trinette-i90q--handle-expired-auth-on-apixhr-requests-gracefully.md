---
# trinette-i90q
title: Handle expired auth on API/XHR requests gracefully
status: completed
type: bug
priority: normal
created_at: 2026-04-04T09:51:05Z
updated_at: 2026-04-04T09:52:22Z
---

When both access and refresh tokens expire, XHR query requests get a 303 redirect to the OIDC provider which fails due to CORS. Refactor to return 401 for API requests and redirect to /auth/login for page navigations.

## Summary of Changes\n\nRefactored OIDC auth to handle expired tokens gracefully for XHR requests:\n- OIDC hook now resolves tokens without redirecting; added /auth/login endpoint for PKCE+redirect\n- Root layout redirects unauthenticated page navigations to /auth/login\n- API proxy returns 401 JSON when unauthenticated\n- Client-side Trino client detects 401 and navigates to /auth/login
