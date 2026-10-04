// Measure scrollWidth of main/section/div top-level wrappers to
// pinpoint which chain of elements has the inflated scrollWidth.
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'https://mtgprices.io/set/dsk/card/404-enduring-vitality';
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => {
    const vp = window.innerWidth;
    // Walk top-down from body — flag any element whose scrollWidth
    // exceeds its clientWidth, and dig deeper into its children.
    const path = [];
    const walk = (el, depth) => {
      if (depth > 15) return;
      if (el.scrollWidth > el.clientWidth) {
        path.push({
          depth,
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className.slice(0, 50) : null,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          offsetWidth: el.offsetWidth,
          ownRight: Math.round(el.getBoundingClientRect().right),
        });
        for (const c of el.children) walk(c, depth + 1);
      }
    };
    walk(document.body, 0);
    return {
      viewport: vp,
      docScrollWidth: document.documentElement.scrollWidth,
      inflatedChain: path,
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
