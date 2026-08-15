const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 2,
  });
  const fileUrl = 'file://' + path.resolve(__dirname, '..', 'pricelist.html').replace(/\\/g, '/');
  await page.goto(fileUrl, { waitUntil: 'networkidle' });
  await page.screenshot({
    path: path.resolve(__dirname, '..', 'out', 'pricelist.png'),
    fullPage: true,
  });
  await browser.close();
  console.log('Saved out/pricelist.png');
})();
