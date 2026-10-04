import { chromium } from 'playwright';
const URL = process.env.URL ?? 'https://mtgprices.io/';
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => {
    const vp = window.innerWidth;
    // Elements whose width > viewport (not just right past viewport)
    const list = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > vp + 0.5) {
        let scrollParent = el.parentElement;
        let hasScrollParentInBounds = false;
        while (scrollParent) {
          const cs = getComputedStyle(scrollParent);
          if (['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowX)) {
            const sr = scrollParent.getBoundingClientRect();
            if (sr.right <= vp + 0.5 && sr.width <= vp + 0.5) {
              hasScrollParentInBounds = true;
              break;
            }
          }
          scrollParent = scrollParent.parentElement;
        }
        if (!hasScrollParentInBounds) {
          list.push({
            tag: el.tagName.toLowerCase(),
            cls: typeof el.className === 'string' ? el.className : null,
            width: Math.round(r.width),
            right: Math.round(r.right),
            text: (el.textContent || '').trim().slice(0, 50),
          });
        }
      }
    }
    return {
      viewport: vp,
      docScrollWidth: document.documentElement.scrollWidth,
      elements: list.slice(0, 20),
      total: list.length,
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
