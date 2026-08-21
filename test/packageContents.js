const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const packed = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: require('node:path').join(__dirname, '..'),
    encoding: 'utf8',
    shell: process.platform === 'win32',
});

assert.equal(packed.status, 0, packed.stderr || packed.stdout);
const result = JSON.parse(packed.stdout);
assert.equal(result.length, 1, 'npm pack must describe exactly one package');

const files = new Set(result[0].files.map(entry => entry.path));
for (const required of [
    'build/main.js',
    'io-package.json',
    'admin/jsonConfig.json',
    'admin/jsonCustom.json',
    'admin/freya.svg',
    'README.md',
    'SECURITY.md',
    'PRIVACY.md',
]) {
    assert(files.has(required), `release package is missing ${required}`);
}

for (const filename of files) {
    assert(!filename.startsWith('src/'), `release package must not contain source: ${filename}`);
    assert(!filename.startsWith('test/'), `release package must not contain tests: ${filename}`);
    assert(!filename.startsWith('.github/'), `release package must not contain workflows: ${filename}`);
    assert(!/(^|\/)(\.env|\.npmrc|id_rsa)(\.|$)/i.test(filename), `sensitive file name packaged: ${filename}`);
}

console.log(`Package smoke test passed (${files.size} files)`);
