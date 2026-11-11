// Renders the three CrazyGames cover images into covers/ (1920x1080, 800x1200, 800x800).
//   npm run covers
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'covers');
mkdirSync(out, { recursive: true });

const bundle = await esbuild.build({ entryPoints: [join(root, 'tools/covers-entry.js')], bundle: true, write: false, format: 'iife' });
const font = readFileSync(join(root, 'public/fonts/fredoka-latin-600-normal.woff2')).toString('base64');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<html><head><style>@font-face{font-family:Fredoka;font-weight:600;src:url(data:font/woff2;base64,${font}) format('woff2')}</style></head><body><span style="font-family:Fredoka;font-weight:600">Flakefall</span></body></html>`);
await page.evaluate(() => document.fonts.load('600 100px Fredoka'));
await page.addScriptTag({ content: bundle.outputFiles[0].text });
for (const [kind, file] of [['landscape', 'cover-landscape-1920x1080.png'], ['portrait', 'cover-portrait-800x1200.png'], ['square', 'cover-square-800x800.png']]) {
  const url = await page.evaluate((k) => window.drawCover(k), kind);
  writeFileSync(join(out, file), Buffer.from(url.split(',')[1], 'base64'));
  console.log('  covers/' + file);
}
await browser.close();
