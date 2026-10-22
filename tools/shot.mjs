// Takes a screenshot of a page with headless Chromium (WebGL via SwiftShader).
// Usage: node tools/shot.mjs <url> <out.png> [width] [height] [waitMs]
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
// Use a local playwright if installed, otherwise the globally installed one.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const req = createRequire(execSync('npm root -g').toString().trim() + '/');
  ({ chromium } = req('playwright'));
}
const [url, out, w = 1280, h = 720, wait = 1500] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(0, 30).join('\n'));
await browser.close();
