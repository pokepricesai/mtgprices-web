// Walk every direct descendant of .mtg-card-hero and ask: what is
// your scrollWidth / min-content size? Point directly at the element
// forcing the hero to balloon to 782px.

import { chromium } from 'playwright';
const URL = process.env.URL ?? 'https://mtgprices.io/set/dsk/card/404-enduring-vitality';
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => {
    const findDeepestWideElement = (root, viewport) => {
      // Walk DOM, find the deepest element whose own scrollWidth
      // exceeds the viewport but whose scrollWidth is roughly equal
      // to the hero's — the one actually driving the balloon.
      const offenders = [];
      const walk = (el, depth = 0) => {
        if (!el || !el.getBoundingClientRect) return;
        const r = el.getBoundingClientRect();
        const sw = el.scrollWidth;
        const cw = el.clientWidth;
        if (sw > viewport + 10) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: (typeof el.className === 'string' ? el.className : '') || null,
            scrollWidth: sw,
            clientWidth: cw,
            left: Math.round(r.left),
            right: Math.round(r.right),
            width: Math.round(r.width),
            text: (el.textContent || '').trim().slice(0, 50),
            depth,
          });
        }
        for (const child of el.children) walk(child, depth + 1);
      };
      walk(root);
      return offenders;
    };
    const hero = document.querySelector('.mtg-card-hero');
    if (!hero) return { error: 'no hero' };
    const direct = Array.from(hero.children).map((c, i) => {
      const r = c.getBoundingClientRect();
      return {
        index: i,
        tag: c.tagName.toLowerCase(),
        cls: typeof c.className === 'string' ? c.className : null,
        scrollWidth: c.scrollWidth,
        clientWidth: c.clientWidth,
        offsetWidth: c.offsetWidth,
        bounding: { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) },
      };
    });
    const offenders = findDeepestWideElement(hero, window.innerWidth);
    // Group offenders by scrollWidth, find the leaves (no wider child)
    const leaves = offenders.filter((o) => {
      // Check if any OTHER offender has a greater depth and comparable width
      // Simpler: pick the ones with the DEEPEST depth per cluster
      return true; // we'll sort below
    });
    offenders.sort((a, b) => b.depth - a.depth);
    return {
      viewport: window.innerWidth,
      heroDirectChildren: direct,
      topOffendersByDepth: offenders.slice(0, 15),
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
