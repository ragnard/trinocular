import type { MetadataProvider } from "monaco-language-trino";
import type { CatalogCache } from "./CatalogCache.svelte";

export class TrinoMetadataProvider implements MetadataProvider {
  #cache: CatalogCache;

  constructor(cache: CatalogCache) {
    this.#cache = cache;
  }

  async getDefaultCatalog(): Promise<string | undefined> {
    return undefined;
  }

  async getDefaultSchema(): Promise<string | undefined> {
    return undefined;
  }

  async getCatalogs(): Promise<string[]> {
    return this.#cache.loadCatalogs();
  }

  async getSchemas(catalog: string): Promise<string[]> {
    return this.#cache.loadSchemas(catalog);
  }

  async getTables(catalog: string, schema: string): Promise<string[]> {
    return this.#cache.loadTables(catalog, schema);
  }
}
