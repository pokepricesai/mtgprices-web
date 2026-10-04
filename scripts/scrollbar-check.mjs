import { chromium } from 'playwright';
const URL = process.env.URL ?? 'https://mtgprices.io/set/dsk/card/404-enduring-vitality';
const browser = await chromium.launch();
try {
  for (const width of [320, 360, 375, 390, 430]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      htmlScrollWidth: document.documentElement.scrollWidth,
      htmlClientWidth: document.documentElement.clientWidth,
      htmlOffsetWidth: document.documentElement.offsetWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      bodyOffsetWidth: document.body.offsetWidth,
      hasVerticalScroll: document.documentElement.scrollHeight > window.innerHeight,
    }));
    await ctx.close();
    console.log(width, JSON.stringify(r));
  }
} finally {
  await browser.close();
}
