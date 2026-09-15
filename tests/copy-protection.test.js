import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('panel prevents visible content and media from being copied or dragged', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const event of ['copy', 'cut', 'dragstart', 'contextmenu']) {
    assert.match(app, new RegExp(`['\"]${event}['\"]`));
  }
  assert.match(app, /selectstart/u);
  assert.match(app, /media\.draggable\s*=\s*false/u);
  assert.match(css, /user-select:none/u);
  assert.match(css, /-webkit-user-drag:none/u);
  assert.match(css, /input,textarea,select\{[^}]*user-select:text/u);
  assert.equal((html.match(/<(?:img|video)\b/gu) || []).length, (html.match(/draggable="false"/gu) || []).length);
});
