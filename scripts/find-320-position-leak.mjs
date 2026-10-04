// Walk DOM, find any element where right > viewport, regardless of
// its width or clipping ancestor. For each, report its chain.
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
    const list = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      // Only elements whose RIGHT is between 320 and 400 — the narrow
      // band where a small overflow lives (ignoring the 780px tables).
      if (r.right > vp && r.right <= 400) {
        list.push({
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className.slice(0, 60) : null,
          id: el.id || null,
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          text: (el.textContent || '').trim().slice(0, 40),
          position: getComputedStyle(el).position,
          transform: getComputedStyle(el).transform,
          marginLeft: getComputedStyle(el).marginLeft,
          marginRight: getComputedStyle(el).marginRight,
        });
      }
    }
    list.sort((a, b) => b.right - a.right);
    return {
      viewport: vp,
      docScrollWidth: document.documentElement.scrollWidth,
      count: list.length,
      topFive: list.slice(0, 5),
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
