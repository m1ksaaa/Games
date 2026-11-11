// Build script for Flakefall.
//   node tools/build.mjs          -> production build in dist/ + release/flakefall-crazygames.zip
//   node tools/build.mjs --serve  -> dev server on http://localhost:8080 (rebuilds on save)
import * as esbuild from 'esbuild';
import { cpSync, rmSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';

const serve = process.argv.includes('--serve');
const root = new URL('..', import.meta.url).pathname;

const common = {
  entryPoints: [join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020', 'chrome80', 'safari15', 'firefox78', 'edge88'],
  legalComments: 'none',
};

if (serve) {
  const ctx = await esbuild.context({
    ...common,
    outfile: join(root, 'public/game.js'),
    sourcemap: true,
    define: { __DEV__: 'true' },
  });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: join(root, 'public'), port: 8080, host: '0.0.0.0' });
  console.log(`Flakefall dev server: http://localhost:${port}/`);
} else {
  const dist = join(root, 'dist');
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  // copy static files (except dev bundle leftovers)
  for (const f of readdirSync(join(root, 'public'))) {
    if (f === 'game.js' || f === 'game.js.map') continue;
    cpSync(join(root, 'public', f), join(dist, f), { recursive: true });
  }
  await esbuild.build({
    ...common,
    outfile: join(dist, 'game.js'),
    minify: true,
    define: { __DEV__: 'false' },
  });

  // report sizes
  let total = 0, count = 0;
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else { total += st.size; count++; console.log(`  ${relative(dist, p).padEnd(40)} ${(st.size / 1024).toFixed(1).padStart(8)} KB`); }
    }
  };
  walk(dist);
  console.log(`  ${'TOTAL'.padEnd(40)} ${(total / 1024).toFixed(1).padStart(8)} KB in ${count} files`);

  // zip for upload (index.html at the zip root, as CrazyGames expects)
  const releaseDir = join(root, 'release');
  mkdirSync(releaseDir, { recursive: true });
  const zipPath = join(releaseDir, 'flakefall-crazygames.zip');
  if (existsSync(zipPath)) rmSync(zipPath);
  execFileSync('zip', ['-r', '-9', '-X', '-q', zipPath, '.'], { cwd: dist });
  console.log(`  -> ${relative(root, zipPath)} (${(statSync(zipPath).size / 1024).toFixed(1)} KB)`);
}
