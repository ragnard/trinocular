/**
 * `${NAME}` in the config file is the environment variable of that name.
 *
 * This is what lets a config be a ConfigMap with one Secret behind it: the
 * cookie secret, the store secret, the OIDC client secret and the passwords of
 * `authn: password` are all strings the file needs and should not hold, and one
 * rule covers every one of them rather than a `*File` variant per secret.
 *
 * It is applied to the *parsed* file, string values only, and never to the raw
 * text: a value substituted into YAML text could change its structure, and a
 * substitution stays the string it was written as — `port: ${PORT}` is a string
 * and the schema says so. `$${` is a literal `${`. A `$` followed by anything
 * else is left alone, so a value that merely contains one (`$2y$…`, `$1`) is
 * not an error. A variable that is unset *is* one: a policy built on an empty
 * secret is exactly the half-configured server startup refuses to be.
 */

const PATTERN = /\$(\$?)\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export class EnvSubstitutionError extends Error {
  constructor(
    readonly variable: string,
    readonly path: string
  ) {
    super(`${path}: environment variable ${variable} is not set`);
    this.name = "EnvSubstitutionError";
  }
}

export const substituteEnv = (
  value: unknown,
  env: Record<string, string | undefined>,
  path = "config"
): unknown => {
  if (typeof value === "string") {
    return value.replace(PATTERN, (_, escaped: string, name: string) => {
      if (escaped) return `\${${name}}`;
      const found = env[name];
      if (found === undefined) throw new EnvSubstitutionError(name, path);
      return found;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => substituteEnv(item, env, `${path}[${i}]`));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substituteEnv(item, env, `${path}.${key}`)])
    );
  }
  return value;
};
