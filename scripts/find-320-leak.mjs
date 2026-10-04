import { chromium } from 'playwright';
const URL = process.env.URL ?? 'https://mtgprices.io/set/dsk/card/404-enduring-vitality';
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => {
    const vp = window.innerWidth;
    // All elements whose RIGHT edge exceeds the viewport, no clipping skip.
    const list = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vp + 0.5) {
        list.push({
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className : null,
          left: Math.round(r.left), right: Math.round(r.right),
          width: Math.round(r.width),
          scrollWidth: el.scrollWidth,
          text: (el.textContent || '').trim().slice(0, 50),
        });
      }
    }
    // Sort by rightmost extent descending.
    list.sort((a, b) => b.right - a.right);
    return {
      viewport: vp,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      firstTen: list.slice(0, 10),
      total: list.length,
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
