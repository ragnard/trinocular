FROM oven/bun:1.4.2 AS builder

WORKDIR /build

COPY . .

RUN --mount=type=cache,target=/build/node_modules bun install --frozen-lockfile
RUN --mount=type=cache,target=/build/node_modules bun run --bun check
RUN --mount=type=cache,target=/build/node_modules bun run --bun build

FROM oven/bun:1.4.2-slim

WORKDIR /app

RUN useradd \
    --home-dir /app \
    --no-create-home \
    --uid 1001 \
    --shell /sbin/nologin \
    trinette

RUN chown trinette:trinette /app

USER trinette

COPY --from=builder --chown=trinette /build/build /app

ENV ORIGIN=http://localhost:3000

CMD ["index.js"]
