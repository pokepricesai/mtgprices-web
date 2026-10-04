// Headless probe: compute document scrollWidth vs innerWidth at a set
// of mobile viewports, and list every element whose bounding rect
// exceeds the viewport. Points directly at the offender.

import { chromium } from 'playwright';

const URL = process.env.URL ?? 'https://mtgprices.io/set/dsk/card/404-enduring-vitality';
const WIDTHS = [320, 375, 390, 430, 820, 1200];

const browser = await chromium.launch();
try {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400); // let any client code settle

    const result = await page.evaluate(() => {
      const vp = window.innerWidth;
      const scrollWidth = document.documentElement.scrollWidth;
      const offenders = [];
      const all = document.querySelectorAll('body *');
      for (const el of all) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const over = r.right > vp + 0.5;
        const underLeft = r.left < -0.5;
        const widerThan = r.width > vp + 0.5;
        if (over || underLeft || widerThan) {
          // Only report elements that aren't inside a scroll container
          // whose own box is contained — i.e. elements that genuinely
          // extend the document, not those happily clipped by a parent.
          let parent = el.parentElement;
          let clipped = false;
          while (parent) {
            const ps = getComputedStyle(parent);
            if (ps.overflowX === 'hidden' || ps.overflowX === 'clip' || ps.overflowX === 'auto' || ps.overflowX === 'scroll') {
              const pr = parent.getBoundingClientRect();
              if (pr.right <= vp + 0.5 && pr.left >= -0.5) { clipped = true; break; }
            }
            parent = parent.parentElement;
          }
          if (!clipped) {
            offenders.push({
              tag: el.tagName.toLowerCase(),
              id: el.id || null,
              cls: (el.className && typeof el.className === 'string') ? el.className : null,
              left: Math.round(r.left),
              right: Math.round(r.right),
              width: Math.round(r.width),
              text: (el.textContent || '').trim().slice(0, 60),
            });
          }
        }
      }
      // Card image coordinates specifically
      const imgEl = document.querySelector('.mtg-card-image-wrap img') || document.querySelector('.mtg-card-image-wrap');
      const imgRect = imgEl ? imgEl.getBoundingClientRect() : null;
      const heroEl = document.querySelector('.mtg-card-hero');
      const heroRect = heroEl ? heroEl.getBoundingClientRect() : null;
      return {
        viewport: vp,
        documentScrollWidth: scrollWidth,
        overflow: scrollWidth - vp,
        offenderCount: offenders.length,
        offenders: offenders.slice(0, 25),
        cardImage: imgRect ? { left: Math.round(imgRect.left), right: Math.round(imgRect.right), width: Math.round(imgRect.width) } : null,
        hero: heroRect ? { left: Math.round(heroRect.left), right: Math.round(heroRect.right), width: Math.round(heroRect.width) } : null,
      };
    });
    await ctx.close();

    console.log(`\n=== viewport ${width}px ===`);
    console.log(`  scrollWidth: ${result.documentScrollWidth}  innerWidth: ${result.viewport}  overflow: ${result.overflow}`);
    if (result.hero)       console.log(`  .mtg-card-hero       left=${result.hero.left} right=${result.hero.right} width=${result.hero.width}`);
    if (result.cardImage)  console.log(`  .mtg-card-image-wrap left=${result.cardImage.left} right=${result.cardImage.right} width=${result.cardImage.width}`);
    if (result.offenders.length === 0) {
      console.log(`  OFFENDERS: none`);
    } else {
      console.log(`  OFFENDERS (first ${Math.min(result.offenderCount, 25)} / ${result.offenderCount}):`);
      for (const o of result.offenders) {
        const label = `<${o.tag}${o.id ? '#' + o.id : ''}${o.cls ? '.' + o.cls.split(/\s+/).slice(0, 3).join('.') : ''}>`;
        console.log(`    L${o.left} R${o.right} W${o.width}  ${label}  "${o.text}"`);
      }
    }
  }
} finally {
  await browser.close();
}
