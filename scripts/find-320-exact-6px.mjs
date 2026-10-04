import { chromium } from 'playwright';
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(process.env.URL ?? 'https://mtgprices.io/set/dsk/card/404-enduring-vitality', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => {
    const vp = window.innerWidth;
    const target = 326;
    const near = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vp && r.right <= target + 2) {
        near.push({
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className : null,
          left: Math.round(r.left), right: Math.round(r.right),
          width: Math.round(r.width),
          scrollWidth: el.scrollWidth,
          offsetWidth: el.offsetWidth,
          text: (el.textContent || '').trim().slice(0, 50),
        });
      }
    }
    near.sort((a, b) => b.right - a.right);
    return {
      viewport: vp,
      docScrollWidth: document.documentElement.scrollWidth,
      elementsAt320To328: near,
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
