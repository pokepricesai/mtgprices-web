import { chromium } from 'playwright';
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('https://mtgprices.io/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => {
    const vp = window.innerWidth;
    // Walk deep, show only elements where scrollWidth > clientWidth by at least 1,
    // AND are not inside an overflow:hidden/clip/auto ancestor whose own
    // scrollWidth==clientWidth.
    const list = [];
    const walk = (el, depth) => {
      if (depth > 12) return;
      if (el.scrollWidth > el.clientWidth + 0.5) {
        // Is it clipped?
        let cur = el.parentElement;
        let clipped = false;
        while (cur) {
          const cs = getComputedStyle(cur);
          if (['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowX)) {
            if (cur.scrollWidth <= cur.clientWidth + 0.5) {
              clipped = true; break;
            }
          }
          cur = cur.parentElement;
        }
        if (!clipped) {
          list.push({
            depth,
            tag: el.tagName.toLowerCase(),
            cls: typeof el.className === 'string' ? el.className.slice(0, 50) : '',
            id: el.id || null,
            sw: el.scrollWidth,
            cw: el.clientWidth,
            delta: el.scrollWidth - el.clientWidth,
            text: (el.textContent || '').trim().slice(0, 40),
          });
        }
      }
      for (const c of el.children) walk(c, depth + 1);
    };
    walk(document.body, 0);
    // Keep only the DEEPEST — leaves of the overflow tree.
    const deepest = list.filter((e) => !list.some((o) => o.depth > e.depth && e.sw <= o.sw + 2));
    return {
      viewport: vp,
      docScrollWidth: document.documentElement.scrollWidth,
      leaves: deepest.slice(0, 20),
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
