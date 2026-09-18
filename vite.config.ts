import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { execSync } from "node:child_process";
import pkg from "./package.json" with { type: "json" };

// Stamped into both bundles as `__TRINETTE_BUILD__`, read through `$lib/build`.
// The version is an input (CI passes `MAJOR.MINOR.<run number>`), never
// computed here: the image's build context has no .git to ask, so git is only
// a fallback for the commit, and a build told nothing is `0.0.0`.
const gitHead = (): string | undefined => {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
};

const build = {
  version: process.env.TRINETTE_VERSION || "0.0.0",
  commit: process.env.TRINETTE_COMMIT || gitHead(),
  source: pkg.homepage
};

export default defineConfig({
  plugins: [sveltekit()],
  define: {
    __TRINETTE_BUILD__: JSON.stringify(build)
  },
  server: {
    fs: {
      allow: ["packages"]
    }
  },
  ssr: {
    // The runtime's own module: nothing to bundle, and adapter-node's rollup
    // would otherwise go looking for it.
    external: ["bun:sqlite"]
  },
  optimizeDeps: {
    // monaco-language-trino is this repo's own source, symlinked in by the
    // workspace. Pre-bundling it would cache a copy in node_modules/.vite that
    // survives edits to packages/, so exclude it: vite then compiles it from
    // source like the rest of src/, with HMR and nothing to invalidate.
    exclude: ["monaco-language-trino"]
  },
  resolve: {
    alias: [
      // Redirect bare `import 'monaco-editor'` to our slim setup,
      // but let deep imports like `monaco-editor/editor/...` pass through.
      {
        find: /^monaco-editor$/,
        replacement: new URL("./src/lib/monaco/monacoSetup.ts", import.meta.url).pathname
      }
    ]
  }
});
