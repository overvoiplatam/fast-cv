import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import markdownlint from '../../src/tools/markdownlint.js';

describe('markdownlint adapter', () => {
  it('has correct metadata', () => {
    assert.equal(markdownlint.name, 'markdownlint');
    assert.deepEqual(markdownlint.extensions, ['.md', '.markdown']);
    assert.equal(markdownlint.supportsFix, true);
    assert.ok(markdownlint.installHint.includes('markdownlint-cli2'));
  });

  it('buildCommand without files uses glob', () => {
    const { bin, args } = markdownlint.buildCommand('/p', null);
    assert.equal(bin, 'markdownlint-cli2');
    assert.ok(args.some(a => a.includes('**/*.{md,markdown}')));
  });

  it('buildCommand with config and fix', () => {
    const { args } = markdownlint.buildCommand('/p', '/etc/.markdownlint.json', { files: ['x.md'], fix: true });
    assert.ok(args.includes('--config'));
    assert.ok(args.includes('/etc/.markdownlint.json'));
    assert.ok(args.includes('--fix'));
    assert.ok(args.includes('x.md'));
  });

  it('parseOutput parses default output format', () => {
    const stderr = [
      'markdownlint-cli2 v0.13.0',
      'Finding: **/*.md',
      'Linting: 1 file(s)',
      'README.md:7 MD013/line-length Line length [Expected: 80; Actual: 120]',
      'README.md:25:3 MD032/blanks-around-lists Lists should be surrounded by blank lines',
      'Summary: 2 error(s)',
    ].join('\n');
    const f = markdownlint.parseOutput('', stderr, 1);
    assert.equal(f.length, 2);
    assert.equal(f[0].file, 'README.md');
    assert.equal(f[0].line, 7);
    assert.equal(f[0].col, undefined);
    assert.equal(f[0].rule, 'md/MD013/line-length');
    assert.equal(f[0].tag, 'DOCS');
    assert.equal(f[0].severity, 'warning');
    assert.equal(f[1].col, 3);
  });

  it('parseOutput returns empty for clean run', () => {
    const stderr = ['markdownlint-cli2 v0.13.0', 'Finding: **/*.md', 'Linting: 0 file(s)', 'Summary: 0 error(s)'].join('\n');
    assert.deepEqual(markdownlint.parseOutput('', stderr, 0), []);
  });

  it('checkInstalled returns boolean', async () => {
    const v = await markdownlint.checkInstalled();
    assert.equal(typeof v, 'boolean');
  });
});
