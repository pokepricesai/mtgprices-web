// Find any element at right in [321, 335] on the card page at 320px.
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
      if (r.right >= vp + 0.5 && r.right <= vp + 15) {
        list.push({
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className.slice(0, 60) : null,
          id: el.id || null,
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          text: (el.textContent || '').trim().slice(0, 40),
          position: getComputedStyle(el).position,
          parentCls: el.parentElement ? (typeof el.parentElement.className === 'string' ? el.parentElement.className.slice(0, 40) : '') : null,
          grandparentCls: el.parentElement?.parentElement ? (typeof el.parentElement.parentElement.className === 'string' ? el.parentElement.parentElement.className.slice(0, 40) : '') : null,
        });
      }
    }
    list.sort((a, b) => b.right - a.right);
    return {
      viewport: vp,
      docScrollWidth: document.documentElement.scrollWidth,
      count: list.length,
      list: list.slice(0, 15),
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
