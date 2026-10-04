// Find the element at exactly right=324 (or very close) on home at 320.
import { chromium } from 'playwright';
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('https://mtgprices.io/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => {
    // Elements whose RIGHT edge is between 321 and 335.
    const list = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right > 320 && r.right <= 335) {
        list.push({
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className.slice(0, 50) : '',
          id: el.id || null,
          left: Math.round(r.left), right: Math.round(r.right),
          width: Math.round(r.width),
          text: (el.textContent || '').trim().slice(0, 40),
          position: getComputedStyle(el).position,
          overflow: getComputedStyle(el).overflow,
          overflowX: getComputedStyle(el).overflowX,
          parent: el.parentElement ? {
            tag: el.parentElement.tagName.toLowerCase(),
            cls: typeof el.parentElement.className === 'string' ? el.parentElement.className.slice(0, 40) : '',
            overflowX: getComputedStyle(el.parentElement).overflowX,
            right: Math.round(el.parentElement.getBoundingClientRect().right),
          } : null,
        });
      }
    }
    list.sort((a, b) => b.right - a.right);
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      count: list.length,
      elements: list.slice(0, 15),
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
