import type { MetadataProvider } from "monaco-language-trino";

export class DelegatingMetadataProvider implements MetadataProvider {
  delegate: MetadataProvider;

  constructor(delegate: MetadataProvider) {
    this.delegate = delegate;
  }

  getDefaultCatalog() {
    return this.delegate.getDefaultCatalog();
  }

  getDefaultSchema() {
    return this.delegate.getDefaultSchema();
  }

  getCatalogs() {
    return this.delegate.getCatalogs();
  }

  getSchemas(catalog: string) {
    return this.delegate.getSchemas(catalog);
  }

  getTables(catalog: string, schema: string) {
    return this.delegate.getTables(catalog, schema);
  }

  getFunctions() {
    return this.delegate.getFunctions();
  }

  getSchemaFunctions(catalog: string, schema: string) {
    return this.delegate.getSchemaFunctions(catalog, schema);
  }
}
