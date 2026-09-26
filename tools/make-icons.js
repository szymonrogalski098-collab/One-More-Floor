// Renders icons/icon.svg to the PNG sizes required by the manifest / iOS.
// Usage: node tools/make-icons.js   (requires playwright + a Chromium build)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const root = path.join(__dirname, '..');
  const svg = fs.readFileSync(path.join(root, 'icons/icon.svg'), 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const targets = [
    ['icon-192.png', 192, 1],
    ['icon-512.png', 512, 1],
    ['apple-touch-icon.png', 180, 1],
    ['icon-maskable-512.png', 512, 0.72],
  ];
  for (const [name, size, inner] of targets) {
    await page.setViewportSize({ width: size, height: size });
    const pad = ((1 - inner) / 2) * 100;
    await page.setContent(`<html><body style="margin:0;background:#0b0a1a">
      <div style="width:${size}px;height:${size}px;background:radial-gradient(circle at 50% 38%,#231c55,#0b0a1a 75%);position:relative">
      <div style="position:absolute;left:${pad}%;top:${pad}%;width:${inner * 100}%;height:${inner * 100}%">${(inner < 1 ? svg.replace(/<rect[^>]*url\(#bg\)[^>]*\/>/, "") : svg).replace('<svg ', '<svg width="100%" height="100%" ')}</div></div></body></html>`);
    await page.screenshot({ path: path.join(root, 'icons', name), omitBackground: false });
    console.log('wrote', name);
  }
  await browser.close();
})();
