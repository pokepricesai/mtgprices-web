// Inspect the actual computed styles the browser applies to the hero
// at mobile widths, to confirm whether the @media rule is winning.

import { chromium } from 'playwright';

const URL = process.env.URL ?? 'https://mtgprices.io/set/dsk/card/404-enduring-vitality';
const browser = await chromium.launch();
try {
  for (const width of [375, 820]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => {
      const hero = document.querySelector('.mtg-card-hero');
      const wrap = document.querySelector('.mtg-card-image-wrap');
      const outer = document.querySelector('.mtg-card-wrap');
      const html = document.documentElement;
      const g = (el) => el ? getComputedStyle(el) : null;
      const h = g(hero);
      const w = g(wrap);
      const o = g(outer);
      const htmlCS = g(html);
      // Count the number of grid tracks the hero currently has
      let heroTracks = null;
      if (hero) {
        heroTracks = h.gridTemplateColumns.split(/\s+/).length;
      }
      return {
        viewport: window.innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        html: { overflowX: htmlCS?.overflowX },
        hero: hero ? {
          display: h.display,
          gridTemplateColumns: h.gridTemplateColumns,
          trackCount: heroTracks,
          width: h.width,
          minWidth: h.minWidth,
          offsetWidth: hero.offsetWidth,
          scrollWidth: hero.scrollWidth,
          clientWidth: hero.clientWidth,
          getBoundingLeft: Math.round(hero.getBoundingClientRect().left),
          getBoundingWidth: Math.round(hero.getBoundingClientRect().width),
        } : null,
        wrap: wrap ? {
          display: w.display,
          maxWidth: w.maxWidth,
          margin: w.margin,
          width: w.width,
          offsetParent: wrap.offsetParent?.tagName,
          parentWidth: wrap.parentElement ? Math.round(wrap.parentElement.getBoundingClientRect().width) : null,
          parentDisplay: wrap.parentElement ? getComputedStyle(wrap.parentElement).display : null,
          bounding: (() => { const r = wrap.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; })(),
        } : null,
        outer: outer ? {
          offsetWidth: outer.offsetWidth,
          scrollWidth: outer.scrollWidth,
          clientWidth: outer.clientWidth,
          overflowX: o.overflowX,
        } : null,
      };
    });
    await ctx.close();
    console.log(`\n=== viewport ${width}px ===`);
    console.log(JSON.stringify(result, null, 2));
  }
} finally {
  await browser.close();
}
