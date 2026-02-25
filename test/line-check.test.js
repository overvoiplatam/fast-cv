import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkFileLines } from '../src/line-check.js';

async function makeTmpDir() {
  const dir = join(tmpdir(), `fcv-line-check-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeLines(dir, name, count) {
  const content = Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n');
  await writeFile(join(dir, name), content, 'utf-8');
}

describe('checkFileLines', () => {
  it('returns empty when maxLines <= 0 (disabled)', async () => {
    const result = await checkFileLines(['a.js'], '/tmp', { maxLines: 0 });
    assert.equal(result.tool, 'line-check');
    assert.equal(result.findings.length, 0);
    assert.equal(result.error, null);
  });

  it('returns empty when all files are under the limit', async () => {
    const dir = await makeTmpDir();
    try {
      await writeLines(dir, 'small.js', 50);
      const result = await checkFileLines(['small.js'], dir, { maxLines: 600 });
      assert.equal(result.findings.length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('flags files exceeding the limit with correct finding shape', async () => {
    const dir = await makeTmpDir();
    try {
      await writeLines(dir, 'big.js', 700);
      const result = await checkFileLines(['big.js'], dir, { maxLines: 600 });
      assert.equal(result.findings.length, 1);
      const f = result.findings[0];
      assert.equal(f.file, 'big.js');
      assert.equal(f.line, 700);
      assert.equal(f.tag, 'REFACTOR');
      assert.equal(f.rule, 'max-lines');
      assert.equal(f.severity, 'warning');
      assert.ok(f.message.includes('700 lines'));
      assert.ok(f.message.includes('limit: 600'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('respects omitPatterns — matching files are skipped', async () => {
    const dir = await makeTmpDir();
    try {
      await mkdir(join(dir, 'migrations'), { recursive: true });
      await writeLines(dir, 'migrations/001.sql', 800);
      await writeLines(dir, 'app.js', 800);
      const result = await checkFileLines(['migrations/001.sql', 'app.js'], dir, {
        maxLines: 600,
        omitPatterns: ['migrations/'],
      });
      assert.equal(result.findings.length, 1);
      assert.equal(result.findings[0].file, 'app.js');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('works with a custom threshold', async () => {
    const dir = await makeTmpDir();
    try {
      await writeLines(dir, 'medium.js', 15);
      const result = await checkFileLines(['medium.js'], dir, { maxLines: 10 });
      assert.equal(result.findings.length, 1);
      assert.equal(result.findings[0].line, 15);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('gracefully handles unreadable files', async () => {
    const dir = await makeTmpDir();
    try {
      const result = await checkFileLines(['nonexistent.js'], dir, { maxLines: 100 });
      assert.equal(result.findings.length, 0);
      assert.equal(result.error, null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('result has valid tool name and duration', async () => {
    const result = await checkFileLines([], '/tmp', { maxLines: 600 });
    assert.equal(result.tool, 'line-check');
    assert.equal(typeof result.duration, 'number');
    assert.ok(result.duration >= 0);
    assert.equal(result.error, null);
  });
});
