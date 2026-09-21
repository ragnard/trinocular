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
