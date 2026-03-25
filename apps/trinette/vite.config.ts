import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    alias: [
      // Redirect bare `import 'monaco-editor'` to our slim setup,
      // but let deep imports like `monaco-editor/esm/...` pass through.
      {
        find: /^monaco-editor$/,
        replacement: new URL('./src/lib/monaco/monacoSetup.ts', import.meta.url).pathname,
      },
    ],
  },
});
