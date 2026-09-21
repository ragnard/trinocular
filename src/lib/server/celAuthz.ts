import { Environment } from "@marcbachmann/cel-js";

import type { Authorizer, Decision } from "./authz";
import type { Identity } from "./identity";

/**
 * A policy written as a CEL expression over the identity.
 *
 * `require-role` answers one question — is this string in that list — and
 * every other question ("either of these groups", "this role *and* a verified
 * email", "these two people, on this cluster") was going to be a new `kind`
 * each. An expression answers all of them in a line, and reads nothing but
 * what every authorizer reads: the claims. So it is one more arm of
 * `createAuthorizer`, and the gate, the proxy and the connection listing are
 * none the wiser.
 *
 * The environment is two variables. `claims` is the identity's claim set as
 * one map rather than each claim as a variable of its own: `has()` only works
 * on a field selection, so `has(claims.groups)` is expressible and
 * `has(groups)` is not, and a claim can then never collide with a CEL keyword
 * or a name of ours. `userId` is beside it because "these two people" is the
 * rule a small deployment wants, and under `authn: none` it is the only thing
 * there is to ask about.
 *
 * Two decisions are made here and both fail closed. An expression must come
 * out *exactly* `true` — not truthy, and a non-boolean is a refusal with a
 * warning, never a coercion. And an evaluation error is a refusal: CEL says a
 * missing map key is an error, so for a user with no `resource_access.finance`
 * the rule `"analyst" in claims.resource_access.finance.roles` does not open
 * the door by accident; it errors, and the answer is no. Anyone who wants a
 * quieter log guards it with `has()`.
 *
 * What can be known before the first request is checked at construction and
 * thrown, for `createAuthorizer` to turn into the same exit a config that will
 * not validate gets: a syntax error, a variable that is not one of the two,
 * and — through the checker's inferred type — an expression that can never be
 * a boolean at all, like `1 + 2`. A bare claim (`claims.email_verified`) checks
 * as `dyn` and is let through, since the checker cannot know what the token
 * will carry; if it turns out not to be a boolean, the refusal at runtime says
 * so.
 */
export class ExpressionError extends Error {}

/** One environment for every expression: building one is the expensive part,
 *  and they all speak the same two variables. */
const environment = new Environment()
  .registerVariable("claims", "map")
  .registerVariable("userId", "string");

/** The library's errors carry the source with a caret under the fault, over
 *  several lines; `summary` is the one-line version, which is what a log line
 *  and a startup failure both want. */
const describe = (error: unknown): string => {
  if (error && typeof error === "object" && "summary" in error) {
    return String((error as { summary: unknown }).summary);
  }
  return error instanceof Error ? error.message : String(error);
};

/** What a non-boolean result was, in CEL's words rather than JavaScript's. */
const kindOf = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  switch (typeof value) {
    case "bigint":
      return "an int";
    case "number":
      return "a double";
    case "string":
      return "a string";
    case "object":
      return "a map";
    default:
      return typeof value;
  }
};

export const CelAuthorizer = (expression: string): Authorizer => {
  const checked = environment.check(expression);
  if (!checked.valid) {
    throw new ExpressionError(describe(checked.error));
  }
  if (checked.type !== "bool" && checked.type !== "dyn") {
    throw new ExpressionError(`expression is of type ${checked.type}, and can never be a boolean`);
  }
  const evaluate = environment.parse(expression);

  return {
    name: `cel(${expression})`,
    authorize(identity: Identity): Decision {
      let result: unknown;
      try {
        result = evaluate({ claims: identity.claims, userId: identity.userId });
      } catch (error) {
        return { allowed: false, reason: `expression failed: ${describe(error)}` };
      }
      if (result === true) return { allowed: true };
      if (result === false) return { allowed: false, reason: "expression evaluated to false" };
      return { allowed: false, reason: `expression evaluated to ${kindOf(result)}, not a boolean` };
    }
  };
};
