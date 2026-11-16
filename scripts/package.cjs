const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { zipSync, strToU8 } = require('fflate');
const repo = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'extension/manifest.json'), 'utf8'));
const name = `uibe-jjfz-learning-helper-v${manifest.version}.zip`;
const root = 'uibe-jjfz-learning-helper';
const entries = {};
const fixedTime = new Date(2026, 10, 16, 0, 0, 0);
for (const file of fs.readdirSync(path.join(repo, 'extension')).sort()) {
  const source = path.join(repo, 'extension', file);
  if (!fs.statSync(source).isFile()) throw new Error(`Unexpected runtime folder: ${file}`);
  entries[`${root}/${file}`] = [new Uint8Array(fs.readFileSync(source)), { mtime: fixedTime }];
}
for (const [source, target] of [
  ['README.md', 'README.md'], ['docs/validation.md', 'docs/validation.md'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md']
]) entries[`${root}/${target}`] = [strToU8(fs.readFileSync(path.join(repo, source), 'utf8')), { mtime: fixedTime }];
const bytes = zipSync(entries, { level: 9 });
const output = path.join(repo, 'dist'); fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, name), bytes);
const hash = crypto.createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), `${hash}  ${name}\n`);
console.log(`Created dist/${name} (${bytes.length} bytes)`);
console.log(`SHA256 ${hash}`);
