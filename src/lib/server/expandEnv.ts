/** `${NAME}` in a string value of the parsed config is the environment variable
 *  NAME, and `$${NAME}` is the literal text. It runs over the parsed tree and
 *  never the file's text, so a value can only ever land as a value: a secret
 *  holding a newline or a `: ` cannot add a key. Keys are never expanded, and a
 *  variable that is not set is an error carrying the path and the name — never
 *  an empty string, which for a secret would be the one outcome worse than not
 *  starting. */

const REFERENCE = /\$(\$?)\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export type Environment = Readonly<Record<string, string | undefined>>;

export interface Unresolved {
  path: string;
  name: string;
}

export class MissingVariableError extends Error {
  constructor(readonly missing: readonly Unresolved[]) {
    super(
      "config references environment variables that are not set: " +
        missing.map(({ path, name }) => `${path} -> \${${name}}`).join(", ")
    );
    this.name = "MissingVariableError";
  }
}

export function expandEnv(value: unknown, env: Environment): unknown {
  const missing: Unresolved[] = [];
  const expanded = walk(value, env, "", missing);
  if (missing.length > 0) {
    throw new MissingVariableError(missing);
  }
  return expanded;
}

function walk(value: unknown, env: Environment, path: string, missing: Unresolved[]): unknown {
  if (typeof value === "string") {
    return value.replace(REFERENCE, (match, escaped: string, name: string) => {
      if (escaped) {
        return match.slice(1);
      }
      const resolved = env[name];
      if (resolved === undefined) {
        missing.push({ path: path || "(root)", name });
        return match;
      }
      return resolved;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => walk(item, env, `${path}[${i}]`, missing));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        walk(item, env, path ? `${path}.${key}` : key, missing)
      ])
    );
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
