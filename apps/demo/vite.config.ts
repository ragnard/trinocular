import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: [
      // Redirect bare `import 'monaco-editor'` to our slim setup,
      // but let deep imports like `monaco-editor/esm/...` pass through.
      {
        find: /^monaco-editor$/,
        replacement: new URL('./monacoSetup.ts', import.meta.url).pathname,
      },
    ],
  },
});
