/**
 * MorseCode — icon generation.
 *
 * Single source of truth: src/assets/logo.svg  ->  src/assets/logo.png (1024px)
 * and the full platform icon set in src-tauri/icons/.
 *
 * This is the offline equivalent of `npm run tauri icon src/assets/logo.png`
 * (kept in-repo so the icon set can be regenerated without the Tauri CLI /
 * network access). Run with:  node scripts/generate-icons.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import png2icons from 'png2icons';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = resolve(root, 'src/assets/logo.svg');
const masterPng = resolve(root, 'src/assets/logo.png');
const iconDir = resolve(root, 'src-tauri/icons');

mkdirSync(iconDir, { recursive: true });

const svg = readFileSync(svgPath);

const render = (size) =>
  sharp(svg, { density: 512 }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toBuffer();

// 1. Master asset used by the React UI (sidebar mark, titlebar mark, consent modal).
writeFileSync(masterPng, await render(1024));

// 2. Square PNGs required by Tauri / Linux / tray, plus the spec'd size ladder.
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
for (const size of sizes) {
  writeFileSync(resolve(iconDir, `${size}x${size}.png`), await render(size));
}
writeFileSync(resolve(iconDir, '32x32.png'), await render(32));
writeFileSync(resolve(iconDir, '128x128.png'), await render(128));
writeFileSync(resolve(iconDir, '128x128@2x.png'), await render(256));
writeFileSync(resolve(iconDir, 'icon.png'), await render(512));
// Monochrome-friendly tray icon (kept full colour: the tile reads well at 22px).
writeFileSync(resolve(iconDir, 'tray.png'), await render(64));
writeFileSync(resolve(iconDir, 'tray@2x.png'), await render(128));

// 3. Windows Store / MSIX logos that `tauri icon` also emits.
const storeLogos = {
  'Square30x30Logo.png': 30,
  'Square44x44Logo.png': 44,
  'Square71x71Logo.png': 71,
  'Square89x89Logo.png': 89,
  'Square107x107Logo.png': 107,
  'Square142x142Logo.png': 142,
  'Square150x150Logo.png': 150,
  'Square284x284Logo.png': 284,
  'Square310x310Logo.png': 310,
  'StoreLogo.png': 50,
};
for (const [name, size] of Object.entries(storeLogos)) {
  writeFileSync(resolve(iconDir, name), await render(size));
}

// 4. Multi-resolution .ico (Windows exe/msi/installer) and .icns (macOS app/dmg).
const big = await render(1024);
writeFileSync(resolve(iconDir, 'icon.ico'), png2icons.createICO(big, png2icons.BILINEAR, 0, true, true));
writeFileSync(resolve(iconDir, 'icon.icns'), png2icons.createICNS(big, png2icons.BILINEAR, 0));

console.log(`✓ icons written to ${iconDir}`);
