export interface MetadataProvider {
  getDefaultCatalog(): Promise<string | undefined>;
  getDefaultSchema(): Promise<string | undefined>;
  getCatalogs(): Promise<string[]>;
  getSchemas(catalog: string): Promise<string[]>;
  getTables(catalog: string, schema: string): Promise<string[]>;
}

export class StaticMetadataProvider implements MetadataProvider {
  private readonly schemas: Record<string, string[]> = {
    tpch: ['sf1', 'tiny', 'information_schema'],
    memory: ['default'],
    system: ['metadata', 'runtime', 'jdbc'],
  };

  private readonly tables: Record<string, string[]> = {
    'tpch.sf1': ['customer', 'lineitem', 'nation', 'orders', 'part', 'partsupp', 'region', 'supplier'],
    'tpch.tiny': ['customer', 'lineitem', 'nation', 'orders', 'part', 'partsupp', 'region', 'supplier'],
  };

  async getDefaultCatalog(): Promise<string | undefined> {
    return 'tpch';
  }

  async getDefaultSchema(): Promise<string | undefined> {
    return 'sf1';
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
}
