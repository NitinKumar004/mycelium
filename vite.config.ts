import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Minimal, self-contained shader loader. Resolves `#include "file"` recursively
// (relative to the including file) and exports the flattened source as a default
// string. Replaces vite-plugin-glsl, which targets Vite 6/rolldown and no-ops on
// Vite 5. Keeps the shared-math-in-one-file architecture (§10) intact.
function shaderInclude(): Plugin {
  const EXT = /\.(wgsl|glsl|vert|frag)$/;
  const INCLUDE = /^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm;

  function flatten(file: string, seen: Set<string>): string {
    const src = fs.readFileSync(file, 'utf8');
    return src.replace(INCLUDE, (_m, rel: string) => {
      const resolved = path.resolve(path.dirname(file), rel);
      if (seen.has(resolved)) return ''; // include-once guard
      seen.add(resolved);
      return flatten(resolved, seen);
    });
  }

  return {
    name: 'shader-include',
    enforce: 'pre',
    transform(_code, id) {
      const file = id.split('?')[0]!;
      if (!EXT.test(file)) return null;
      const flattened = flatten(file, new Set([file]));
      return { code: `export default ${JSON.stringify(flattened)};`, map: null };
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [shaderInclude()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
