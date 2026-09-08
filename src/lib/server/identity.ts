/** Who is making the request, as established by authentication.
 *
 *  `claims` is whatever the authn mechanism was able to say about the user —
 *  for OIDC, the token claims verbatim. Authorization reads from here and
 *  nowhere else, which is what keeps the two halves independent: an authz rule
 *  never learns which provider issued the identity, and an authn mechanism
 *  never learns what a rule will go looking for. */
export interface Identity {
  userId: string;
  claims: Claims;
}

export type Claims = Record<string, unknown>;

/** A route into a claim set, one segment per level.
 *
 *  Segments rather than a dotted string because a segment can itself contain a
 *  dot: an OIDC clientId is free text and `com.example.app` is an ordinary one,
 *  so `resource_access.com.example.app.roles` built by interpolation would be
 *  read as six levels and find nothing — silently refusing a user who does hold
 *  the role. (The same shape of bug as reading a tree node's kind back out of a
 *  dotted id in the schema browser, and it gets the same answer: never re-parse
 *  what you already had structured.) */
export type ClaimPath = readonly string[];

/** Splits a path written by hand in config. A dot is the separator there, so a
 *  segment containing one cannot be expressed this way — which is why the
 *  Keycloak default builds its path from segments instead of going through
 *  here. */
export const parseClaimPath = (path: string): string[] => path.split(".");

/** Renders a path for a log line, bracketing any segment that contains a dot so
 *  `resource_access["com.example.app"].roles` cannot be misread as four
 *  levels. */
export const formatClaimPath = (path: ClaimPath): string =>
  path
    .map((segment, i) =>
      segment.includes(".") ? `[${JSON.stringify(segment)}]` : i === 0 ? segment : `.${segment}`
    )
    .join("");

/** Walks a claim set. A missing or non-object step reads as undefined rather
 *  than throwing. */
export function claim(claims: Claims, path: ClaimPath): unknown {
  let value: unknown = claims;
  for (const segment of path) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

/** The string members of a claim that ought to be a list of strings. A claim
 *  that is absent, or is not an array, reads as no entries at all: a role check
 *  has no use for the difference between "no roles" and "roles claim
 *  malformed", and both have to fail closed. */
export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
