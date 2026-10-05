import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLeadingJson, majorFromVersion, skipUnlessFileExists, resolveReportedPath } from '../src/adapter-helpers.js';

describe('parseLeadingJson', () => {
  it('parses a clean object', () => {
    assert.deepEqual(parseLeadingJson('{"Issues":[]}'), { Issues: [] });
  });

  it('parses with trailing human text (golangci-lint v2 summary)', () => {
    const data = parseLeadingJson('{"Issues":[{"Text":"x"}]}\n2 issues.\n');
    assert.deepEqual(data, { Issues: [{ Text: 'x' }] });
  });

  it('parses with leading status text before the document', () => {
    const data = parseLeadingJson('Output {info}\n{"ok":true}');
    assert.deepEqual(data, { ok: true });
  });

  it('handles braces and escaped quotes inside strings', () => {
    const data = parseLeadingJson('{"Text":"curly {oops} and quote \\"here\\""}\n1 issue.');
    assert.deepEqual(data, { Text: 'curly {oops} and quote "here"' });
  });

  it('restarts the scan when a leading brace is not JSON', () => {
    // "{1 of 3}" is a balanced non-JSON candidate; the real object follows.
    const data = parseLeadingJson('step {1 of 3} done\n{"done":false}');
    assert.deepEqual(data, { done: false });
  });

  it('handles newlines and blank padding around the document', () => {
    assert.deepEqual(parseLeadingJson('\n\n {"a":1} \n\ntrailer'), { a: 1 });
  });

  it('throws when no braces exist', () => {
    assert.throws(() => parseLeadingJson('no json here'), /no parseable JSON object/);
  });

  it('throws when the object never closes', () => {
    assert.throws(() => parseLeadingJson('{"open":'), /no parseable JSON object/);
  });

  it('throws when the input is not a string', () => {
    assert.throws(() => parseLeadingJson(undefined), /not a string/);
  });
});

describe('majorFromVersion', () => {
  it('parses golangci-lint v2 style version lines', () => {
    assert.equal(majorFromVersion('golangci-lint has version 2.10.1 built with go1.26.0'), 2);
  });

  it('parses v-prefixed versions (eslint, typos)', () => {
    assert.equal(majorFromVersion('vVersion: v10.12.0'), 10);
    assert.equal(majorFromVersion('typos-cli 1.2.3 (revision)'), 1);
  });

  it('returns null when no dotted version is present', () => {
    assert.equal(majorFromVersion('no version in here'), null);
    assert.equal(majorFromVersion(''), null);
  });

  it('never matches an undotted number as a version', () => {
    // "0 issues." has no dotted triple — no major to infer.
    assert.equal(majorFromVersion('0 issues.'), null);
  });

  it('treats plain version output as a major', () => {
    assert.equal(majorFromVersion('9.39.5'), 9);
  });
});

describe('resolveReportedPath', () => {
  it('passes absolute paths through untouched', () => {
    assert.equal(resolveReportedPath('/tmp/abs/main.go'), '/tmp/abs/main.go');
  });

  it('recovers a tool-relative path against the real file location', async () => {
    // Simulates golangci-lint v2: the tool's cwd was targetDir, but it emits
    // the path relative to a base it chose itself (here, the tmpdir root).
    const root = await mkdtemp(join(tmpdir(), 'fcv-res-'));
    const proj = join(root, 'proj');
    await mkdir(proj);
    writeFileSync(join(proj, 'main.go'), 'package main\n');
    assert.equal(
      resolveReportedPath('proj/main.go', { targetDir: proj }),
      join(root, 'proj', 'main.go'),
    );
  });

  it('recovers ../-laden paths that normalize back into the target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fcv-res2-'));
    writeFileSync(join(root, 'main.go'), 'package main\n');
    // The observed golangci-lint v2 shape: enough ../ to climb out past the
    // filesystem root, then re-enter through the real absolute remainder —
    // TMPDIR-agnostic: depth of the target decides how many ../ are needed.
    const parts = root.split('/').filter(Boolean);
    const depth = parts.length;
    const filename = [...Array(depth).fill('..'), ...parts, 'main.go'].join('/');
    assert.equal(
      resolveReportedPath(filename, { targetDir: root }),
      join(root, 'main.go'),
    );
  });

  it('returns the original when no base exists (unknown file)', () => {
    assert.equal(
      resolveReportedPath('nope/main.go', { targetDir: '/definitely/not/here' }),
      'nope/main.go',
    );
  });
});

describe('skipUnlessFileExists', () => {
  it('returns null when the file exists (real fixture dir)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fcv-skip-'));
    writeFileSync(join(dir, 'package.json'), '{}');
    const skip = skipUnlessFileExists('package.json');
    assert.equal(skip({ targetDir: dir }), null);
  });

  it('returns the custom note when the file is missing', () => {
    const skip = skipUnlessFileExists('package.json', 'knip: not a JS project (no package.json in target) — skipped');
    const note = skip({ targetDir: join(tmpdir(), 'fcv-does-not-exist') });
    assert.equal(note, 'knip: not a JS project (no package.json in target) — skipped');
  });

  it('builds a generic note when none is provided', () => {
    const skip = skipUnlessFileExists('go.work');
    const note = skip({ targetDir: '/definitely/not/here' });
    assert.equal(note, 'go.work not found in target — skipped');
  });
});
