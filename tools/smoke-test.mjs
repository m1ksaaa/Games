// Headless smoke test: builds nothing, serves dist/, plays through a fall on desktop + phone layouts,
// checks for console errors and the CrazyGames SDK call order, and saves screenshots to test-shots/.
//   npm run build && npm test
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
// Playwright is preinstalled globally in CI/dev containers; fall back to a local install.
const { chromium } = createRequire(import.meta.url)('playwright');

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
const shots = join(root, 'test-shots');
mkdirSync(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const server = createServer((req, res) => {
  const p = join(dist, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(dist) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0);
const port = server.address().port;
const mock = readFileSync(join(root, 'tools/mock-sdk.js'), 'utf8');

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

async function session(name, contextOpts, steps, withSdk = true) {
  const browser = await chromium.launch();
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('https://sdk.crazygames.com/**', (r) => (withSdk ? r.fulfill({ contentType: 'text/javascript', body: mock }) : r.abort()));
  await page.goto(`http://localhost:${port}/index.html?ffdebug`);
  await page.waitForSelector('#scr-menu:not([hidden])', { timeout: 10000 });
  await steps(page, name);
  if (!withSdk) errors.splice(0, errors.length, ...errors.filter((e) => !/ERR_FAILED|Failed to load resource/.test(e)));
  check(errors.length === 0, `${name}: no console errors ${errors.length ? JSON.stringify(errors.slice(0, 5)) : ''}`);
  await browser.close();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await session('desktop', { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }, async (page, name) => {
  await wait(600);
  await page.screenshot({ path: join(shots, `${name}-1-menu.png`) });
  await page.click('#btn-play');
  await page.mouse.move(500, 400);
  await wait(2500);
  await page.screenshot({ path: join(shots, `${name}-2-start.png`) });
  await page.evaluate(() => window.__ff.sim(22));
  await wait(400);
  await page.screenshot({ path: join(shots, `${name}-3-mid.png`) });
  const perf = await page.evaluate(() => window.__ff.perf());
  console.log('      render cost (ms):', JSON.stringify(perf));
  check(perf.sprite < 8 && perf.lens < 8, `${name}: crystal re-render is cheap enough (sprite ${perf.sprite.toFixed(2)} ms, lens ${perf.lens.toFixed(2)} ms)`);
  // pause / resume via keyboard
  await page.keyboard.press('Escape');
  await wait(200);
  check(await page.isVisible('#scr-pause'), `${name}: Escape pauses`);
  await page.screenshot({ path: join(shots, `${name}-4-pause.png`) });
  await page.click('#btn-resume');
  await page.evaluate(() => window.__ff.sim(120, true, 'final'));
  await page.evaluate(() => window.__ff.sim(0.6));
  await wait(150);
  await page.screenshot({ path: join(shots, `${name}-5-final.png`) });
  const state = await page.evaluate(() => window.__ff.sim(120));
  check(state === 'landed' || state === 'failed', `${name}: run ends (state=${state})`);
  if (state === 'failed') {
    await wait(1200);
    await page.screenshot({ path: join(shots, `${name}-5-fail.png`) });
    await page.click('#btn-giveup');
  }
  await page.waitForSelector('#scr-result:not([hidden])', { timeout: 5000 });
  await wait(1200);
  await page.screenshot({ path: join(shots, `${name}-6-result.png`) });
  const info = await page.evaluate(() => ({ name: document.getElementById('res-name').textContent, r: window.__ff.run.result() }));
  console.log('      result:', info.name, JSON.stringify({ ...info.r, st: undefined }), JSON.stringify(info.r.st));
  await page.click('#btn-double');
  await wait(800);
  await page.click('#btn-next');
  await wait(1000);
  check(await page.evaluate(() => window.__ff.mode === 'play'), `${name}: next flake starts a new run after midgame ad`);
  await page.keyboard.press('Escape');
  await page.click('#btn-quit');
  await wait(300);
  await page.click('#btn-album');
  await wait(400);
  await page.screenshot({ path: join(shots, `${name}-7-album.png`) });
  await page.click('#scr-album [data-back]');
  await page.click('#btn-shop');
  await wait(300);
  await page.screenshot({ path: join(shots, `${name}-8-shop.png`) });
  const log = await page.evaluate(() => window.__sdkLog.filter((x) => x !== 'data.setItem'));
  console.log('      sdk log:', log.join(' > '));
  check(log[0] === 'init' && log[1] === 'loadingStart' && log[2] === 'loadingStop', `${name}: init > loadingStart > loadingStop`);
  let balanced = true, playing = false;
  for (const e of log) {
    if (e === 'gameplayStart') { if (playing) balanced = false; playing = true; }
    if (e === 'gameplayStop') { if (!playing) balanced = false; playing = false; }
    if (e.startsWith('requestAd') && playing) balanced = false;
  }
  check(balanced, `${name}: gameplayStart/Stop alternate and ads never play during gameplay`);
  check(log.includes('requestAd:midgame') && log.includes('requestAd:rewarded'), `${name}: midgame + rewarded ads requested`);
  const saved = await page.evaluate(() => window.__sdkLog.includes('data.setItem'));
  check(saved, `${name}: progress saved through SDK data module`);
});

await session('phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, async (page, name) => {
  await wait(600);
  await page.screenshot({ path: join(shots, `${name}-1-menu.png`) });
  await page.tap('#btn-play');
  await wait(1500);
  await page.evaluate(() => window.__ff.sim(15));
  await wait(300);
  await page.screenshot({ path: join(shots, `${name}-2-mid.png`) });
  await page.evaluate(() => window.__ff.run.fail('melt'));
  await page.waitForSelector('#scr-fail:not([hidden])', { timeout: 5000 });
  await page.screenshot({ path: join(shots, `${name}-2b-fail.png`) });
  await page.tap('#btn-revive');
  await wait(900);
  check(await page.evaluate(() => window.__ff.mode === 'play' && window.__ff.run.state !== 'failed'), `${name}: rewarded ad revives the flake`);
  const state = await page.evaluate(() => window.__ff.sim(120));
  if (state === 'failed') { await wait(1200); await page.tap('#btn-giveup'); }
  await page.waitForSelector('#scr-result:not([hidden])', { timeout: 5000 });
  await wait(1200);
  await page.screenshot({ path: join(shots, `${name}-3-result.png`) });
});

await session('mobile-landscape', { viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 }, async (page, name) => {
  await wait(600);
  await page.screenshot({ path: join(shots, `${name}-1-menu.png`) });
  await page.click('#btn-play');
  await wait(1200);
  await page.evaluate(() => window.__ff.sim(18));
  await wait(300);
  await page.screenshot({ path: join(shots, `${name}-2-mid.png`) });
  const state = await page.evaluate(() => window.__ff.sim(120));
  if (state === 'failed') { await wait(1200); await page.click('#btn-giveup'); }
  await page.waitForSelector('#scr-result:not([hidden])', { timeout: 5000 });
  await wait(1200);
  await page.screenshot({ path: join(shots, `${name}-3-result.png`) });
});

await session('skies', { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }, async (page, name) => {
  for (const sky of ['peaks', 'city', 'aurora']) {
    await page.evaluate((id) => {
      const ff = window.__ff;
      for (const sp of ['hex', 'star', 'stellar', 'sectored', 'dendrite', 'mixed', 'fern']) ff.save.species[sp] = { count: 1, best: 1, flake: null, sky: 'village' };
      ff.save.sky = id;
      ff.startRun();
    }, sky);
    await page.evaluate(() => window.__ff.sim(16));
    await wait(300);
    await page.screenshot({ path: join(shots, `${name}-${sky}-mid.png`) });
    const st = await page.evaluate(() => window.__ff.sim(150, true, 'final'));
    await page.evaluate(() => window.__ff.sim(0.5));
    await wait(200);
    await page.screenshot({ path: join(shots, `${name}-${sky}-final.png`) });
    const end = await page.evaluate(() => { const r = window.__ff.run; return { state: r.state, twin: r.crystal.twin, rime: r.crystal.rime.length, hits: r.stats.hits }; });
    console.log(`      ${sky}:`, JSON.stringify(end));
    check(end.state !== 'fall', `${name}: ${sky} plays to the end`);
    await page.keyboard.press('Escape');
    await page.click('#btn-quit');
  }
});

await session('no-sdk', { viewport: { width: 1280, height: 720 } }, async (page, name) => {
  await page.click('#btn-play');
  await wait(500);
  const st = await page.evaluate(() => window.__ff.sim(150));
  if (st === 'failed') { await wait(1200); await page.click('#btn-giveup'); }
  await page.waitForSelector('#scr-result:not([hidden])', { timeout: 5000 });
  await page.click('#btn-next');
  await wait(400);
  check(await page.evaluate(() => window.__ff.mode === 'play'), `${name}: playable without the CrazyGames SDK`);
}, false);

server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
