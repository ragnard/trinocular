# Security

Trinocular sits between people and their Trino clusters: it holds sessions, forwards
bearer tokens, and runs whatever SQL it is given as whoever is signed in. A weakness here
is a weakness in every cluster behind it, so reports are taken seriously and handled
privately.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it through GitHub's private vulnerability reporting:
[github.com/ragnard/trinocular/security/advisories/new](https://github.com/ragnard/trinocular/security/advisories/new).
That opens a private thread between you and the maintainer, where a fix and an advisory
can be worked on before anything is public.

Include what you can of: the version or image tag (`ghcr.io/ragnard/trinocular:<tag>`, or
the commit at the foot of the account menu), the `authn`/`authz` kinds in use, steps to
reproduce, and what an attacker gains. A proof of concept against your own deployment is
welcome; please do not test against clusters or deployments that are not yours.

You will get an acknowledgement within a few days. This is a single-maintainer project, so
a fix may take longer than that, but you will hear what is happening and when. Credit in
the advisory is offered to every reporter who wants it.

## Supported versions

Only the latest build of `main` — which is what `ghcr.io/ragnard/trinocular:latest` and
the highest-numbered version tag point at. There are no maintained release branches;
a fix ships as the next build.

## What is in scope

Anything that lets a user of a Trinocular deployment do more than the operator's
configuration allows, or that exposes what it should not. In particular:

- the access gate and the authorizers (`authn`, `authz`, per-connection `authz`)
- the proxy: reaching a host, path or identity other than the configured connection's,
  or sending an `X-Trino-*` header that names somebody else
- the session cookie and the session stores (a token that can be read back out of a
  store, or a session that can be planted in a browser)
- the content security policy: a value in a query result becoming script or reaching
  another origin
- the file store API: reading or writing another user's documents

Bugs in Trino itself, in your identity provider, or in a cluster's own access control
are out of scope here and belong with those projects.

## What this project deliberately does not do

So that it is not reported as a finding:

- Under `authn: none` everybody is one named user with no login. That is the
  development mode, and the README says so.
- Under `authn: password` the passwords are stored in the configuration file as written
  (the `${VAR}` form is how they stay out of it). There is no hashing by design; see
  `config.example.yaml`.
- Files (users' SQL) are not encrypted in any store. Sessions are, in every store but
  `memory`.
- `branding.logo` and `branding.message` are operator HTML rendered as written. The
  config file is trusted; the CSP is what keeps a script in it from running.
- The proxy sends `X-Trino-User` from the gate's identity and the bearer token from the
  session. What a user may then do on the cluster is the cluster's access control, not
  Trinocular's.
