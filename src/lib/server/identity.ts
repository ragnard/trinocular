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

/** Reads a dotted path out of a claim set, e.g. `resource_access.trinette.roles`.
 *  A missing or non-object step reads as undefined rather than throwing. */
export function claim(claims: Claims, path: string): unknown {
  let value: unknown = claims;
  for (const segment of path.split(".")) {
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
