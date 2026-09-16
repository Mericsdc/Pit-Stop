import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('authentication shell never paints the login panel over an active workspace', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/layout.css', import.meta.url), 'utf8');

  assert.match(html, /<section id="login-panel" class="login-screen" hidden>/u);
  assert.match(html, /<section id="workspace" hidden>/u);
  assert.ok(app.includes("function showLogin() {\n  $('#workspace').hidden = true;\n  $('#login-panel').hidden = false;"));
  assert.ok(app.includes("$('#login-panel').hidden = true;\n    $('#workspace').hidden = false;"));
  assert.ok(css.includes('body:not(.logged-out) #login-panel { display: none !important; }'));
  assert.ok(css.includes('body.logged-out #workspace { display: none !important; }'));
});
