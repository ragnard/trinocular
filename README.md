# Trinette

A web-based SQL query IDE for the [Trino](https://trino.io) distributed query engine.

## Features

- Write SQL with autocompletion, highlighting and errors marked as you type.
- Keep many statements in one file and run any of them on its own, each with its own
  results.
- See what a running query is actually doing, and stop it if it is doing too much.
- Inspect one or more rows of a result set, field by field, with nested values spelled
  out.
- Flexible value display — read a field as text or as JSON, and have the choice
  remembered.
- Browse a cluster's catalogs, schemas, tables and columns, and search what you have
  opened.
- Support for querying multiple Trino instances — each file picks its own, so
  re-pointing one query leaves the rest alone.
- Save any result as CSV or NDJSON without running the query again.
- Keep your files between visits and jump between them with a keystroke.
- Read it light or dark, following your system or whichever you prefer.
- Put a login in front of it, and decide who gets to reach which cluster.
- Run more than one copy of it, and restart it, without signing anyone out.

## Running locally

Requires [bun](https://bun.sh).

```bash
bun install
bun run dev      # http://localhost:5173
```

Trinette needs a config file and its own address. Point `TRINETTE_CONFIG` at the file
and set `ORIGIN` to the URL the app is served from — both can go in `.env`:

```
ORIGIN=http://localhost:5173
TRINETTE_CONFIG=config.dev.yaml
```

A minimal `config.dev.yaml` — no login, one cluster:

```yaml
session:
  cookie:
    secret: <at least 32 characters>

authn:
  kind: none
  user: alice

connections:
  local:
    name: Local Trino
    uri: http://localhost:8080
```

See [Configuration](#configuration) for everything else.

Other commands: `bun run build` (production build), `bun run preview`, `bun run check`
(type-check).

## Configuration

The config file is JSON or YAML, named by the `TRINETTE_CONFIG` environment variable. It
is validated at startup; anything invalid stops the server rather than letting it come up
with half a policy.

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `TRINETTE_CONFIG` | no | Path to the config file. Without it the server starts with no clusters, no login, and a cookie secret generated afresh on every start. |
| `ORIGIN` | for OIDC | The URL the app is served from, e.g. `https://trinette.example.com`. Used to build the OIDC redirect, and to decide whether the session cookie is marked `Secure` (it is, unless `ORIGIN` starts with `http://`). |
| `LOG_LEVEL` | no | `trace`, `debug`, `info` (default), `warn`, `error`, `fatal` or `silent`. An unrecognised value warns and falls back to `info`. |
| `PORT`, `HOST` | no | Where the server listens. Defaults to `3000` on all interfaces. |

### `session`

```yaml
session:
  maxLifetimeSeconds: 86400
  cookie:
    name: trinette-session
    secret: <at least 32 characters>
    path: /
    httpOnly: true
    secure: true
    sameSite: lax
    domain: trinette.example.com
    maxAge: 86400
```

| Option | Default | Description |
| --- | --- | --- |
| `maxLifetimeSeconds` | `86400` | How long a session lives, in seconds. |
| `cookie.secret` | **required** | Key the session cookie is encrypted with, and the key sessions in a `valkey` store are encrypted with. At least 32 characters. |
| `cookie.name` | `trinette-session` | Cookie name. |
| `cookie.path` | `/` | Cookie path. |
| `cookie.httpOnly` | `true` | Hide the cookie from scripts. |
| `cookie.secure` | from `ORIGIN` | Send the cookie over HTTPS only. Defaults to true unless `ORIGIN` is `http://`. |
| `cookie.sameSite` | `lax` | `strict`, `lax` or `none`. |
| `cookie.domain` | — | Cookie domain, if it must be wider than the host. |
| `cookie.maxAge` | — | Cookie lifetime in seconds, if the cookie should outlive the browser session. |
| `store.kind` | `memory` | Where sessions are kept: `memory` or `valkey`. In memory, a restart signs everyone out and every request from a user has to reach the same copy of Trinette. |

#### `store.kind: valkey`

Sessions in [Valkey](https://valkey.io) or Redis, so they survive a restart and any
number of copies of Trinette can serve them. Each session is one key, encrypted with
`cookie.secret` — a copy of the store gives away nothing without it, and changing the
secret signs everyone out (as it already does through the cookie).

```yaml
session:
  store:
    kind: valkey
    mode: single           # or cluster, or sentinel
    host: valkey.example
    port: 6379
    db: 0
    password: ...
    tls: true
```

| Option | Default | Description |
| --- | --- | --- |
| `mode` | **required** | `single`, `cluster` or `sentinel`. |
| `keyPrefix` | `trinette:session:` | Prefix on every key, if the store is shared with something else. |
| `username` | — | ACL user (Valkey 6 or later). |
| `password` | — | Password for the nodes. |
| `tls` | `false` | `true` to connect over TLS trusting the system's CAs, or `{ ca: <path> }` for a PEM bundle of your own. In `sentinel` mode this applies to the sentinels too. |
| `connectTimeoutMs` | `10000` | How long to wait for a connection. |
| `commandTimeoutMs` | `5000` | How long to wait for an answer. A request that has to wait longer fails rather than hanging. |

With `mode: single`:

| Option | Default | Description |
| --- | --- | --- |
| `host` | `127.0.0.1` | |
| `port` | `6379` | |
| `db` | `0` | Database number. |

With `mode: cluster`:

| Option | Default | Description |
| --- | --- | --- |
| `nodes` | **required** | A list of `{ host, port }` (port defaults to `6379`). One reachable node is enough to discover the rest. |

With `mode: sentinel`:

| Option | Default | Description |
| --- | --- | --- |
| `sentinels` | **required** | A list of `{ host, port }` (port defaults to `26379`). |
| `name` | **required** | The master's name as the sentinels know it. |
| `sentinelUsername` | — | ACL user for the sentinels, if they are secured separately from the nodes. |
| `sentinelPassword` | — | Password for the sentinels. |
| `db` | `0` | Database number. |

Trinette refuses to start if it cannot reach the store, for the same reason it refuses
a config it cannot validate.

### `authn` — who the user is

Either no login at all, or OpenID Connect.

```yaml
authn:
  kind: none
  user: alice
  claims:
    groups: [analysts]
```

| Option | Default | Description |
| --- | --- | --- |
| `user` | **required** | The user everybody is signed in as. |
| `claims` | `{}` | Claims to pretend this user has, so an authorization rule can be tried without an identity provider. |

```yaml
authn:
  kind: oidc
  issuer: https://keycloak.example/realms/prod
  clientId: trinette
  clientSecret: ...
  scope: openid profile email
  userIdClaim: preferred_username
  claimsFrom: id_token
  paths:
    prefix: /auth
    login: login
    logout: logout
    callback: callback
    error: error
```

| Option | Default | Description |
| --- | --- | --- |
| `issuer` | **required** | Issuer URL; the provider's metadata is discovered from it. |
| `clientId` | **required** | Client Trinette signs in as. |
| `clientSecret` | **required** | Its secret. |
| `scope` | **required** | Scopes to request, e.g. `openid profile email`. |
| `userIdClaim` | `preferred_username` | Which claim names the user. |
| `claimsFrom` | `id_token` | Which token the claims are read from. Keycloak puts client roles in the `access_token` unless the client roles mapper has "Add to ID token" ticked, so a role rule usually wants `access_token`. |
| `paths.prefix` | `/auth` | Where the login, logout and callback routes live. |
| `paths.login` / `logout` / `callback` / `error` | as named | The segments under that prefix. |

The redirect URI to register with the provider is `ORIGIN` + prefix + callback, e.g.
`https://trinette.example.com/auth/callback`. Signing out also ends the session at the
provider, so register `ORIGIN` + `/` as a valid post-logout redirect URI too.

### `authz` — who is allowed in

```yaml
authz:
  kind: allow          # the default: anyone who signed in
```

```yaml
authz:
  kind: require-role
  role: user
  client: trinette     # optional
  claim: realm_access.roles   # optional, overrides `client`
```

| Option | Default | Description |
| --- | --- | --- |
| `role` | **required** | The role a user must hold. |
| `client` | this app's `clientId` | Which OIDC client's roles are consulted — Keycloak's `resource_access.<client>.roles`. |
| `claim` | — | A dotted path to a list of strings, for providers laid out differently: `realm_access.roles`, `groups`. Overrides `client`. |

A missing claim, or one that is not a list of strings, counts as no roles and is refused.

### `connections` — the Trino clusters

Each key is the connection's id, used internally and in stored files; the `name` is what
users see.

```yaml
connections:
  warehouse:
    name: Warehouse
    uri: https://trino.example:8443
  finance:
    name: Finance
    uri: https://trino-finance.example:8443
    authz:
      kind: require-role
      role: finance
```

| Option | Default | Description |
| --- | --- | --- |
| `name` | **required** | Label shown in the UI. |
| `uri` | **required** | The cluster's base URL. Only the server talks to it; browsers reach it through Trinette. |
| `authz` | — | An extra rule for this cluster, in the same vocabulary as the top-level one. It can only narrow: the application-wide rule has already been applied, so a connection rule can keep people out of one cluster but never let anyone past the front door. A cluster a user may not use is not offered to them. |

Signed-in users reach a cluster as themselves — Trinette passes their user id, and their
access token if they logged in with OIDC — so the cluster's own access control still
applies.

## Running the container

Images are published to GitHub Packages, as Debian slim (default) and distroless:

```bash
docker run --rm -p 3000:3000 \
  -e ORIGIN=http://localhost:3000 \
  -e TRINETTE_CONFIG=/etc/trinette/config.yaml \
  -v "$PWD/config.yaml:/etc/trinette/config.yaml:ro" \
  ghcr.io/ragnard/trinette:latest
```

`ORIGIN` must be set: the session cookie's `Secure` flag is derived from it, and it is
where the OIDC provider redirects back to.

To build it yourself:

```bash
docker build -t trinette .                          # debian slim
docker build -t trinette --target distroless .      # distroless
```

### Health probes

Two endpoints answer without a session or a login, on the same port as everything else:

| Path | Says | Checks |
| --- | --- | --- |
| `/livez` | the process is answering HTTP | nothing else — a store outage never fails it, since a restart would not fix one |
| `/readyz` | this replica can serve requests | the session store answers a ping (with `store.kind: memory` that is always true) |

Both return `200` with a small JSON body, or `503` from `/readyz` with `{"status":"unavailable",
"checks":{"sessionStore":"failed"}}` — the reason is in the log, not the body. `GET` and
`HEAD` are accepted. They are not written to the request log.

Readiness deliberately does **not** check the Trino clusters or the OIDC provider: those are
shared by every replica, so an outage there would pull every replica out of rotation at once
and turn "cannot run a query" into "cannot reach the site", for everyone already signed in.

```yaml
livenessProbe:
  httpGet: { path: /livez, port: 3000 }
  periodSeconds: 10
readinessProbe:
  httpGet: { path: /readyz, port: 3000 }
  periodSeconds: 10
```
