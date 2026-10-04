// Find the element driving document scrollWidth at 320px.
// Strategy: walk DOM; for each element whose RIGHT edge > vp,
// report ALSO its parent chain so we can see which actually
// contributes to document width (vs being contained by a scroll
// ancestor). We DO NOT short-circuit on overflow:hidden parents
// here — we want to see the raw picture.

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
    // Only elements whose scrollWidth or offsetWidth is 320 < X < 400
    // (i.e. slightly over viewport — not the giant 780 table).
    const near = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      const sw = el.scrollWidth;
      const ow = el.offsetWidth;
      // We want elements that are 320-350px wide — slightly over.
      // Those are the actual culprits for a 324 scrollWidth.
      const widthMarker = Math.max(ow, Math.round(r.width));
      if (widthMarker > vp && widthMarker <= 400) {
        // Record parent chain to see context
        const chain = [];
        let p = el;
        let depth = 0;
        while (p && depth < 6) {
          chain.push({
            tag: p.tagName.toLowerCase(),
            cls: (typeof p.className === 'string' ? p.className : '').slice(0, 60),
            ow: p.offsetWidth,
            sw: p.scrollWidth,
            cw: p.clientWidth,
          });
          p = p.parentElement;
          depth += 1;
        }
        near.push({
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className : null,
          id: el.id || null,
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          scrollWidth: sw,
          offsetWidth: ow,
          text: (el.textContent || '').trim().slice(0, 40),
          computed: {
            width: getComputedStyle(el).width,
            minWidth: getComputedStyle(el).minWidth,
            padding: getComputedStyle(el).padding,
            boxSizing: getComputedStyle(el).boxSizing,
            display: getComputedStyle(el).display,
          },
          chain,
        });
      }
    }
    // Dedupe by uniqueness — many duplicates possible
    return {
      viewport: vp,
      docScrollWidth: document.documentElement.scrollWidth,
      count: near.length,
      elements: near.slice(0, 15),
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
