# Trinette

A web-based SQL query IDE for the [Trino](https://trino.io) distributed query engine.

## Features

- Write SQL with autocompletion, highlighting and errors marked as you type.
- Keep many statements in one file and run any of them on its own, each with its own
  results.
- See what a running query is actually doing, and stop it if it is doing too much.
- Keep a big result from flooding the screen: a run pauses after the first thousand
  rows, or however many you set, and asks before fetching more, or all of them. Switch
  the cap off for runs that should not stop.
- Inspect one or more rows of a result set, field by field, with nested values spelled
  out — in a side pane, or opened full-window to step from row to row.
- Flexible value display — read a field as text, as a hex dump, as JSON, as rendered
  Markdown or HTML, or see the image a binary column holds, and have the choice
  remembered. Rendered
  documents are sandboxed: nothing in a result can run script or reach the network.
- Browse a cluster's catalogs, schemas, tables and columns, search what you have
  opened, and reload any branch the cluster has changed underneath — and see why
  when it will not list one.
- Take a ready-made SELECT of every column, or the CREATE statement the cluster itself
  writes, for any table in the browser — copied, or dropped straight into your file.
- Support for querying multiple Trino instances — each file picks its own, so
  re-pointing one query leaves the rest alone.
- Read results in columns sized to what is in them, filling the width you give the
  table; drag a column's edge to size it yourself, or double-click it to fit its contents.
- Copy a cell as it is, or a block of cells as CSV, with the usual shortcut — nested
  values come out as JSON.
- Save any result as CSV or NDJSON without running the query again.
- Keep your files between visits and jump between them with a keystroke — and, when the
  server keeps them, find them from any browser you sign in from.
- Read it light or dark, following your system or whichever you prefer.
- Put a login in front of it, and decide who gets to reach which cluster.
- Run more than one copy of it, and restart it, without signing anyone out.

## Trying it

[`demo/compose.yaml`](demo/compose.yaml) runs Trinette with nothing to configure. If you
have no Trino, it starts one:

```bash
cd demo
docker compose up
```

If you have one, name it and no second Trino is started:

```bash
TRINO_URL=http://host.docker.internal:8080 docker compose up
```

Either way, Trinette is on [http://localhost:3000](http://localhost:3000). There is no
login — everyone is `alice` — and nothing survives the containers. The bundled Trino is a
large image that wants a couple of gigabytes of memory, and it comes with the `tpch`,
`tpcds`, `memory` and `jmx` catalogs, so there is something to run straight away:

```sql
SELECT * FROM tpch.tiny.nation
```

Without compose, the same thing is one `docker run`:

```bash
docker run --rm -p 3000:3000 \
  --add-host host.docker.internal:host-gateway \
  -e TRINO_URL=http://host.docker.internal:8080 \
  -e ORIGIN=http://localhost:3000 \
  ghcr.io/ragnard/trinette:latest
```

`ORIGIN` is not optional here even though there is no login: without it the server assumes
https and hands the browser follow-up URLs on a scheme nothing is listening on. Otherwise
`TRINO_URL` is the whole configuration. For anything more than a look —
a login, more than one cluster, sessions that outlive a restart — write a config file
instead; see [Configuration](#configuration).

## Running locally

Requires [bun](https://bun.sh).

```bash
bun install
bun run dev      # http://localhost:5173
```

For a look around, one variable is enough and there is no file to write:

```bash
TRINO_URL=http://localhost:8080 bun run dev
```

Otherwise Trinette needs a config file and its own address. Point `TRINETTE_CONFIG` at the
file and set `ORIGIN` to the URL the app is served from — both can go in `.env`:

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
(type-check), `bun run format` (prettier).

## Configuration

The config file is JSON or YAML, named by the `TRINETTE_CONFIG` environment variable. It
is validated at startup; anything invalid stops the server rather than letting it come up
with half a policy.

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `TRINETTE_CONFIG` | no | Path to the config file. Without it, and without `TRINO_URL`, the server starts with no clusters, no login, and a cookie secret generated afresh on every start. |
| `TRINO_URL` | no | One Trino cluster's base URL, standing in for a config file — no login, sessions in memory, a cookie secret generated afresh on every start, and the cluster named after the URL's host. It is read **only** when `TRINETTE_CONFIG` is unset: setting both stops the server, since a config file is where a connection belongs once there is one. |
| `ORIGIN` | for OIDC, and for the container | The URL the app is served from, e.g. `https://trinette.example.com`. Used to build the OIDC redirect, and to decide whether the session cookie is marked `Secure` (it is, unless `ORIGIN` starts with `http://` — or unless there is no config file at all, where an absent `ORIGIN` means a laptop rather than a deployment and the flag defaults to off). |
| `LOG_LEVEL` | no | `trace`, `debug`, `info` (default), `warn`, `error`, `fatal` or `silent`. An unrecognised value warns and falls back to `info`. |
| `PORT`, `HOST` | no | Where the server listens. Defaults to `3000` on all interfaces. |
| `BODY_SIZE_LIMIT` | no | The most a request body may be, `512K` by default. Raise it together with `files.maxBytes` if documents are allowed to be bigger than that. |

### `branding`

```yaml
branding:
  name: Warehouse SQL
  message: 'Questions? <a href="https://wiki.example/trino">#data-help</a>'
```

| Option | Default | Description |
| --- | --- | --- |
| `name` | `trinette` | The name shown at the top left of the window. |
| `message` | — | HTML shown in the middle of the top bar: a notice, a link to where help is. It is rendered as written, so it is only ever yours; a `<script>` in it does not run, because the app's content security policy allows none. |

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
| `cookie.secret` | **required** | Key the session cookie is encrypted with. At least 32 characters. |
| `cookie.name` | `trinette-session` | Cookie name. |
| `cookie.path` | `/` | Cookie path. |
| `cookie.httpOnly` | `true` | Hide the cookie from scripts. |
| `cookie.secure` | from `ORIGIN` | Send the cookie over HTTPS only. Defaults to true unless `ORIGIN` is `http://` (with no config file, an absent `ORIGIN` defaults it to false instead). |
| `cookie.sameSite` | `lax` | `strict`, `lax` or `none`. |
| `cookie.domain` | — | Cookie domain, if it must be wider than the host. |
| `cookie.maxAge` | — | Cookie lifetime in seconds, if the cookie should outlive the browser session. |
| `store.kind` | `memory` | Where sessions are kept: `memory`, `sqlite` or `valkey`. In memory, a restart signs everyone out and every request from a user has to reach the same copy of Trinette. |

#### `store.kind: valkey`

Sessions in [Valkey](https://valkey.io) or Redis, so they survive a restart and any
number of copies of Trinette can serve them. Each session is one key, encrypted with
the store's own `secret` — a copy of the store gives away nothing without it, and
changing it signs everyone out. It is deliberately not `cookie.secret`: the cookie
secret guards what the browser holds and this one guards what the store holds, and
either can be rotated without touching the other.

```yaml
session:
  store:
    kind: valkey
    secret: <at least 32 characters>
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
| `secret` | **required** | Key sessions in the store are encrypted with. At least 32 characters, and not the same string as `cookie.secret`. |
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

#### `store.kind: sqlite`

Sessions in a [SQLite](https://sqlite.org) file, so they survive a restart with nothing
else to run. It is for a single copy of Trinette: the file is opened for this process
alone, and a second copy pointed at the same file refuses to start rather than share it.
Sessions are encrypted with the store's own `secret`, as in Valkey, since the file is
what a volume snapshot or a backup copies.

```yaml
session:
  store:
    kind: sqlite
    path: /data/sessions.sqlite
    secret: <at least 32 characters>
```

| Option | Default | Description |
| --- | --- | --- |
| `path` | **required** | The database file. Created if it does not exist; the directory must. |
| `secret` | **required** | Key sessions in the file are encrypted with. At least 32 characters, and not the same string as `cookie.secret`. |

### `files` — where query files are kept

By default a user's files live in their browser, and only there: another browser, or the
same one with its storage cleared, starts empty. With a server store they follow the
person instead — keyed by their user id, so what `authn` says the user's id is decides
whose files they see — and a browser that had files of its own hands them over the
next time it visits, then forgets its own copies, so the server is the only place they
are. Switching back to `browser` therefore starts each browser from whatever it made
since, not from what it had before: a move to the server is not meant to be undone,
and the files are in the store if it has to be.

```yaml
files:
  maxBytes: 524288
  store:
    kind: sqlite
    path: /data/files.sqlite
```

| Option | Default | Description |
| --- | --- | --- |
| `maxBytes` | `524288` | The most one document may be, in bytes of its stored record. A save over it is refused, and the editor says so. The default is the server's own request body limit; raise `BODY_SIZE_LIMIT` with it. |
| `store.kind` | `browser` | `browser`, `memory`, `sqlite` or `valkey`. `memory` is for development: the files are gone when the process is. |

Files are not encrypted in the store, whichever it is — the SQL text is what a copy of
the store is for.

#### `store.kind: sqlite`

Files in a SQLite file, for a single copy of Trinette: as for sessions, the file is this
process's alone, and a second copy pointed at it refuses to start.

| Option | Default | Description |
| --- | --- | --- |
| `path` | **required** | The database file. Created if it does not exist; the directory must. |

Sessions and files can share a directory but should be two files: the session file can
be deleted to sign everyone out without touching a document.

For Kubernetes, that is one replica, a `ReadWriteOnce` volume mounted at `/data`, and a
Deployment with `strategy: Recreate` so an update stops the old pod before starting the
new one — the volume can only be attached to one node at a time, and the old pod holds
it until it is gone.

#### `store.kind: valkey`

Files in Valkey or Redis, so any number of copies of Trinette can serve them. A user's
documents are one hash under their user id; make sure the server persists to disk (AOF
or RDB), since unlike a session a lost file is not something a user can sign in again to
get back.

```yaml
files:
  store:
    kind: valkey
    mode: single           # or cluster, or sentinel
    host: valkey.example
    port: 6379
    password: ...
```

It takes the same options as the session store's `valkey` — `mode` and what each mode
needs, `username`, `password`, `tls`, `connectTimeoutMs`, `commandTimeoutMs` — except
that there is no `secret`, and `keyPrefix` defaults to `trinette:files:`. The two blocks
are independent: they can name the same server, where the prefixes keep them apart, or
different ones.

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
| `/readyz` | this replica can serve requests | the session store and the file store each answer a ping (a `memory` or `browser` store always does) |

Both return `200` with a small JSON body, or `503` from `/readyz` with `{"status":"unavailable",
"checks":{"sessionStore":"failed","fileStore":"ok"}}` — the reason is in the log, not the
body. `GET` and `HEAD` are accepted. They are not written to the request log.

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

## License

Apache License 2.0; see [LICENSE](LICENSE). Third-party material and its licenses are listed in
[NOTICE](NOTICE): the Trino SQL grammar and the Trino JavaScript client it builds on are Apache
2.0, and the Iosevka Aile font is under the SIL Open Font License 1.1.
