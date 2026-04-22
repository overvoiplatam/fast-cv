import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { runDocspec } from '../../src/tools/docspec/runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX_SRC = join(__dirname, '..', 'fixtures', 'docspec');

let tmp;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fcv-docspec-fix-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function copy(name) {
  const src = readFileSync(join(FIX_SRC, name), 'utf-8');
  const dest = join(tmp, name);
  writeFileSync(dest, src);
  return dest;
}

describe('docspec --fix', () => {
  it('adds leading slash to OpenAPI path keys', async () => {
    const f = copy('openapi-bad-path.yaml');
    await runDocspec({ files: [f], fix: true });
    const after = readFileSync(f, 'utf-8');
    assert.ok(after.includes('/pets:'), `expected /pets in fixed source:\n${after}`);
    const rerun = await runDocspec({ files: [f] });
    assert.equal(rerun.filter(x => x.rule === 'openapi/path-prefix').length, 0);
  });

  it('is a no-op on already-clean files', async () => {
    const f = copy('openapi-valid.yaml');
    const before = readFileSync(f, 'utf-8');
    await runDocspec({ files: [f], fix: true });
    const after = readFileSync(f, 'utf-8');
    assert.equal(before, after);
  });

  it('quotes unquoted swagger: 2.0 → "2.0"', async () => {
    const f = copy('swagger-unquoted-version.yaml');
    await runDocspec({ files: [f], fix: true });
    const after = readFileSync(f, 'utf-8');
    assert.ok(/swagger:\s*"2\.0"/.test(after), `expected quoted swagger version:\n${after}`);
  });
});
