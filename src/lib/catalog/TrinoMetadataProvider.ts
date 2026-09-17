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

/** For a workspace with no connections: completion has no cluster to ask, and
 *  asking the proxy for one would be a 404 behind every popup. */
export const NOTHING_TO_DESCRIBE: MetadataProvider = {
  getDefaultCatalog: async () => undefined,
  getDefaultSchema: async () => undefined,
  getCatalogs: async () => [],
  getSchemas: async () => [],
  getTables: async () => []
};
