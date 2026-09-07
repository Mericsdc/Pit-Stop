import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const panelUrl = process.env.PUBLIC_PANEL_URL?.trim().replace(/\/$/, '') || '';
if (panelUrl) {
  const url = new URL(panelUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('PUBLIC_PANEL_URL güvenli panel kök adresi (https://...) olmalı.');
  }
}
const output = resolve('site-dist');
await mkdir(output, { recursive: true });
await cp('public', output, { recursive: true });
let html = await readFile(`${output}/index.html`, 'utf8');
html = html.replace(/(href|src)="\//g, '$1="./');
await writeFile(`${output}/index.html`, html);
let css = await readFile(`${output}/styles.css`, 'utf8');
css = css.replaceAll("url('/assets/", "url('./assets/");
await writeFile(`${output}/styles.css`, css);
await writeFile(`${output}/site-config.js`, `export const staticHosting = true;\nexport const livePanelUrl = ${JSON.stringify(panelUrl)};\n`);
await writeFile(`${output}/.nojekyll`, '');
console.log('GitHub Pages sitesi hazır: site-dist/');
