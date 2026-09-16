import adapter from '@sveltejs/adapter-node';

const config = {
  kit: {
    adapter: adapter(),
    // The app draws whatever a cluster returns, so the value of a policy here
    // is that a string arriving in a result cell can never become script. Kit
    // hashes its own inline bootstrap ("auto"), which is why script-src needs
    // nothing loosened; the rest is what Monaco requires and no more.
    csp: {
      mode: 'auto',
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        // Monaco writes a <style> element at runtime for the theme it was
        // handed, and sets style="" on the lines it renders. Neither can be
        // hashed ahead of time, and dropping this is what makes the editor
        // render as unstyled text.
        'style-src': ['self', 'unsafe-inline'],
        // vite emits the editor worker as its own same-origin file and falls
        // back to a blob when a browser will not take a module worker.
        'worker-src': ['self', 'blob:'],
        'img-src': ['self', 'data:'],
        // The codicon glyphs Monaco draws its chevrons and warnings with.
        'font-src': ['self', 'data:'],
        // Only ever this app's own proxy: /api/trino/<connectionId>.
        'connect-src': ['self'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
        // A SQL console is not something to embed; the query it is showing was
        // run as whoever is signed in.
        'frame-ancestors': ['none']
      }
    },
    experimental: {
      remoteFunctions: true
    }
  },
  compilerOptions: {
    experimental: {
      async: true
    }
  },
  vitePlugin: {
    dynamicCompileOptions: ({ filename }) =>
      filename.includes('node_modules') ? undefined : { runes: true }
  }
};

export default config;
