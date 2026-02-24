import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pruneDirectory } from '../src/pruner.js';

describe('pruneDirectory', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fcv-test-'));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('finds scannable files and detects languages', async () => {
    await writeFile(join(tmpDir, 'app.py'), 'print("hello")');
    await writeFile(join(tmpDir, 'index.js'), 'console.log("hi")');
    await writeFile(join(tmpDir, 'main.go'), 'package main');

    const { files, languages } = await pruneDirectory(tmpDir);

    assert.ok(files.includes('app.py'));
    assert.ok(files.includes('index.js'));
    assert.ok(files.includes('main.go'));
    assert.ok(languages.has('.py'));
    assert.ok(languages.has('.js'));
    assert.ok(languages.has('.go'));
  });

  it('ignores node_modules and __pycache__', async () => {
    await mkdir(join(tmpDir, 'node_modules'), { recursive: true });
    await writeFile(join(tmpDir, 'node_modules', 'dep.js'), '');
    await mkdir(join(tmpDir, '__pycache__'), { recursive: true });
    await writeFile(join(tmpDir, '__pycache__', 'cached.py'), '');

    const { files } = await pruneDirectory(tmpDir);

    assert.ok(!files.some(f => f.includes('node_modules')));
    assert.ok(!files.some(f => f.includes('__pycache__')));
  });

  it('ignores lock files', async () => {
    await writeFile(join(tmpDir, 'package-lock.json'), '{}');
    await writeFile(join(tmpDir, 'yarn.lock'), '');

    const { files } = await pruneDirectory(tmpDir);

    assert.ok(!files.includes('package-lock.json'));
    assert.ok(!files.includes('yarn.lock'));
  });

  it('ignores non-scannable files', async () => {
    await writeFile(join(tmpDir, 'image.png'), '');
    await writeFile(join(tmpDir, 'doc.pdf'), '');
    await writeFile(join(tmpDir, 'readme.md'), '');

    const { files } = await pruneDirectory(tmpDir);

    assert.ok(!files.includes('image.png'));
    assert.ok(!files.includes('doc.pdf'));
    assert.ok(!files.includes('readme.md'));
  });

  it('respects .gitignore patterns', async () => {
    await writeFile(join(tmpDir, '.gitignore'), 'ignored_dir/\ntemp.py\n');
    await mkdir(join(tmpDir, 'ignored_dir'), { recursive: true });
    await writeFile(join(tmpDir, 'ignored_dir', 'secret.py'), '');
    await writeFile(join(tmpDir, 'temp.py'), '');

    const { files } = await pruneDirectory(tmpDir);

    assert.ok(!files.some(f => f.includes('ignored_dir')));
    assert.ok(!files.includes('temp.py'));
  });

  it('respects .fcvignore patterns', async () => {
    await writeFile(join(tmpDir, '.fcvignore'), 'generated/\n');
    await mkdir(join(tmpDir, 'generated'), { recursive: true });
    await writeFile(join(tmpDir, 'generated', 'auto.js'), '');

    const { files } = await pruneDirectory(tmpDir);

    assert.ok(!files.some(f => f.includes('generated')));
  });

  it('returns sorted file list', async () => {
    const { files } = await pruneDirectory(tmpDir);
    const sorted = [...files].sort();
    assert.deepEqual(files, sorted);
  });

  it('handles nested directories', async () => {
    await mkdir(join(tmpDir, 'src', 'utils'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'utils', 'helper.py'), '');

    const { files } = await pruneDirectory(tmpDir);
    assert.ok(files.includes(join('src', 'utils', 'helper.py')));
  });
});
