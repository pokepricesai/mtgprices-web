import { chromium } from 'playwright';
const URL = process.env.URL ?? 'https://mtgprices.io/set/dsk/card/404-enduring-vitality';
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => {
    // Find elements that genuinely extend the document scroll — their
    // right edge contributes to body.scrollWidth. Filter to those
    // whose nearest overflow-x: hidden|auto|clip ancestor's right edge
    // is ALSO past viewport (meaning the clip is leaking).
    const vp = window.innerWidth;
    const results = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right <= vp + 0.5) continue;
      // Climb to find scroll parents.
      let cur = el.parentElement;
      let clipped = false;
      while (cur) {
        const cs = getComputedStyle(cur);
        const ox = cs.overflowX;
        if (ox === 'hidden' || ox === 'clip' || ox === 'auto' || ox === 'scroll') {
          const cr = cur.getBoundingClientRect();
          if (cr.right <= vp + 0.5) { clipped = true; break; }
        }
        cur = cur.parentElement;
      }
      if (!clipped) {
        results.push({
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className : null,
          left: Math.round(r.left), right: Math.round(r.right),
          width: Math.round(r.width),
          text: (el.textContent || '').trim().slice(0, 60),
        });
      }
    }
    results.sort((a, b) => a.right - b.right);
    return {
      viewport: vp,
      docScrollWidth: document.documentElement.scrollWidth,
      count: results.length,
      elements: results.slice(0, 15),
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
