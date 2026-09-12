import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let files = 0;
for (const directory of ['src', 'scripts', 'tests', 'public']) {
  for (const entry of readdirSync(directory, { recursive: true })) {
    if (!entry.endsWith('.js')) continue;
    const file = join(directory, entry);
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.error || result.status !== 0) process.exit(result.status || 1);
    files += 1;
  }
}
const { commands } = await import('../src/commands.js');
const { createMusic } = await import('../src/music.js');
const music = createMusic({}, { getSettings: () => ({}) });
const { createFeatures } = await import('../src/features.js');
const names = new Set();
for (const command of [...commands, ...music.commands, ...createFeatures({}, {}).commands]) {
  const payload = command.data.toJSON();
  if (names.has(payload.name)) throw new Error(`Duplicate command: ${payload.name}`);
  names.add(payload.name);
}
console.log(`${files} JavaScript dosyası ve ${names.size} Discord komutu doğrulandı.`);
