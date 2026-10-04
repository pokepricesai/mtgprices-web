// Find any element at right > 320 that is NOT inside the hero-shell
// (so overflow:hidden on hero-shell is excluded).
import { chromium } from 'playwright';
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('https://mtgprices.io/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => {
    const vp = window.innerWidth;
    const heroShell = document.querySelector('.hero-shell');
    const list = [];
    for (const el of document.querySelectorAll('body *')) {
      if (heroShell && heroShell.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vp + 0.5 && r.right <= vp + 50) {
        list.push({
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className.slice(0, 50) : '',
          id: el.id || null,
          left: Math.round(r.left), right: Math.round(r.right),
          width: Math.round(r.width),
          text: (el.textContent || '').trim().slice(0, 40),
          overflowX: getComputedStyle(el).overflowX,
          parent: el.parentElement ? {
            tag: el.parentElement.tagName.toLowerCase(),
            cls: typeof el.parentElement.className === 'string' ? el.parentElement.className.slice(0, 40) : '',
            overflowX: getComputedStyle(el.parentElement).overflowX,
          } : null,
        });
      }
    }
    list.sort((a, b) => a.right - b.right);
    return { docScrollWidth: document.documentElement.scrollWidth, count: list.length, first20: list.slice(0, 20) };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
