# syntax=docker/dockerfile:1

# One file, two runtime targets (`--target runtime` / `--target distroless`).
# They were two files, and they drifted: the distroless one never set USER, so
# the published `-slim` image ran as root.

ARG BUN_VERSION=1.4.2

# --- build -------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION} AS builder

WORKDIR /build

# Manifests first: editing a .svelte file must not re-run `bun install`. The
# cache mount is on bun's global package cache, not on node_modules — node_modules
# is build output and belongs in a layer, where `cache-from: type=gha` can
# actually restore it. Cache mounts are not exported by any cache backend, so
# mounting node_modules meant CI reinstalled from scratch on every single build.
COPY package.json bun.lock .npmrc ./
COPY packages/monaco-language-trino/package.json packages/monaco-language-trino/

RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

COPY . .

RUN bun run --bun check
RUN bun run --bun build

# A writable HOME for the distroless stage to copy in. That image has no shell,
# so the directory cannot be created there; and bun refuses to start without
# somewhere to write ("bun is unable to write files: EACCES").
RUN mkdir -p /home/trinette

# --- runtime (debian slim) ---------------------------------------------------
FROM oven/bun:${BUN_VERSION}-slim AS runtime

WORKDIR /app

# The base image already ships bun as uid/gid 1000; the hand-rolled `useradd`
# added a second unprivileged user at 1001 for no gain, and left the two images
# disagreeing about who owns /app.
COPY --from=builder --chown=bun:bun /build/build /app

USER bun

ENV NODE_ENV=production
EXPOSE 3000

# ORIGIN is deliberately NOT baked in. `hooks.server.ts` derives the session
# cookie's Secure flag from it (`env.ORIGIN?.startsWith("https") ?? true`), so a
# hardcoded http://localhost:3000 default flipped Secure to false in every
# deployment that forgot to override it. Unset, the flag defaults to true and
# OIDC fails loudly instead of redirecting users to localhost. Supply it at run
# time: `docker run -e ORIGIN=https://trinette.example.com ...`

# adapter-node's output is fully bundled — no node_modules in the final image.
CMD ["index.js"]

# --- runtime (distroless) ----------------------------------------------------
FROM oven/bun:${BUN_VERSION}-distroless AS distroless

WORKDIR /app

# Numeric, not `--chown=trinette`: this image has no /etc/passwd, so a name
# silently resolves to 0:0 rather than failing the build.
COPY --from=builder --chown=1000:1000 /build/build /app
COPY --from=builder --chown=1000:1000 /home/trinette /home/trinette

USER 1000:1000

# uid 1000 has no passwd entry here, so HOME is unset and bun tries to write to
# an unwritable /. This is why the image previously "worked" only as root.
ENV HOME=/home/trinette
ENV NODE_ENV=production
EXPOSE 3000

CMD ["index.js"]
