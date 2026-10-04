import { chromium } from 'playwright';
import fs from 'fs/promises';

const URL = process.env.URL ?? 'https://mtgprices.io/set/dsk/card/404-enduring-vitality';
const outDir = 'manual-assets/mobile-proof';
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const width of [320, 375, 390, 430]) {
    const ctx = await browser.newContext({ viewport: { width, height: 1800 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const path = `${outDir}/card-page-${width}.png`;
    await page.screenshot({ path, fullPage: false });
    console.log(`saved ${path}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
