/**
 * What a function is, as far as completion is concerned. This is Trino's own
 * `Function Type` from `SHOW FUNCTIONS`, and it is what decides *where* a name
 * may be offered: a table function is only ever written inside `TABLE(...)`,
 * and the other three only ever inside an expression.
 */
export type FunctionKind = "scalar" | "aggregate" | "window" | "table";

/**
 * One function *name*, with its overloads folded together — `abs` is seven rows
 * of `SHOW FUNCTIONS` and one thing to offer. `signatures` keeps the order the
 * cluster listed them in and is never empty: a name with no signature would not
 * be a function.
 */
export interface FunctionInfo {
  name: string;
  kind: FunctionKind;
  /** `(bigint, double) → bigint`, one per overload. */
  signatures: string[];
  /** The first non-empty description among the overloads; often empty. */
  description: string;
}

export interface MetadataProvider {
  getDefaultCatalog(): Promise<string | undefined>;
  getDefaultSchema(): Promise<string | undefined>;
  getCatalogs(): Promise<string[]>;
  getSchemas(catalog: string): Promise<string[]>;
  getTables(catalog: string, schema: string): Promise<string[]>;
  /** What a bare name can resolve to: the built-ins, plus the session path. */
  getFunctions(): Promise<FunctionInfo[]>;
  /** The functions stored in one schema, which only some connectors have. */
  getSchemaFunctions(catalog: string, schema: string): Promise<FunctionInfo[]>;
}

export class StaticMetadataProvider implements MetadataProvider {
  private readonly schemas: Record<string, string[]> = {
    tpch: ["sf1", "tiny", "information_schema"],
    memory: ["default"],
    system: ["metadata", "runtime", "jdbc"]
  };

  private readonly tables: Record<string, string[]> = {
    "tpch.sf1": [
      "customer",
      "lineitem",
      "nation",
      "orders",
      "part",
      "partsupp",
      "region",
      "supplier"
    ],
    "tpch.tiny": [
      "customer",
      "lineitem",
      "nation",
      "orders",
      "part",
      "partsupp",
      "region",
      "supplier"
    ]
  };

  private readonly functions: FunctionInfo[] = [
    {
      name: "abs",
      kind: "scalar",
      signatures: ["(bigint) → bigint", "(double) → double"],
      description: "Absolute value"
    },
    { name: "count", kind: "aggregate", signatures: ["() → bigint"], description: "" },
    { name: "lower", kind: "scalar", signatures: ["(varchar) → varchar"], description: "" },
    { name: "row_number", kind: "window", signatures: ["() → bigint"], description: "" },
    {
      name: "sequence",
      kind: "table",
      signatures: ["(bigint, bigint) → table"],
      description: ""
    }
  ];

  async getDefaultCatalog(): Promise<string | undefined> {
    return "tpch";
  }

  async getDefaultSchema(): Promise<string | undefined> {
    return "sf1";
  }

  async getCatalogs(): Promise<string[]> {
    return Object.keys(this.schemas);
  }

  async getSchemas(catalog: string): Promise<string[]> {
    return this.schemas[catalog] ?? [];
  }

  async getTables(catalog: string, schema: string): Promise<string[]> {
    return this.tables[`${catalog}.${schema}`] ?? [];
  }

  async getFunctions(): Promise<FunctionInfo[]> {
    return this.functions;
  }

  async getSchemaFunctions(): Promise<FunctionInfo[]> {
    return [];
  }
}
