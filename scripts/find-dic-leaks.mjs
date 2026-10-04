// Probe inside the DeckIntelligenceCard specifically.
import { chromium } from 'playwright';
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('https://mtgprices.io/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => {
    // Find the DeckIntelligenceCard by text content.
    let dic = null;
    for (const el of document.querySelectorAll('div')) {
      if ((el.textContent || '').startsWith('MTGPrices AIAsk AI →Ask about cards')) {
        if (!dic || dic.contains(el)) dic = el;
      }
    }
    if (!dic) return { error: 'DIC not found' };
    const findWidest = [];
    const walk = (el, depth) => {
      const r = el.getBoundingClientRect();
      findWidest.push({
        depth,
        tag: el.tagName.toLowerCase(),
        cls: typeof el.className === 'string' ? el.className.slice(0, 40) : '',
        cw: el.clientWidth,
        sw: el.scrollWidth,
        bbWidth: Math.round(r.width),
        text: (el.textContent || '').trim().slice(0, 35),
      });
      for (const c of el.children) walk(c, depth + 1);
    };
    walk(dic, 0);
    // Sort by scrollWidth descending
    findWidest.sort((a, b) => b.sw - a.sw);
    return {
      viewport: window.innerWidth,
      dicWidth: Math.round(dic.getBoundingClientRect().width),
      dicCw: dic.clientWidth,
      dicSw: dic.scrollWidth,
      top: findWidest.slice(0, 15),
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
