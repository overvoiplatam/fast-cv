import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pruneDirectory, createIgnoreFilter, createOnlyFilter } from '../src/pruner.js';

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

  it('ignores .svelte-kit and other framework build dirs', async () => {
    for (const dir of ['.svelte-kit', '.angular', '.turbo', '.expo', '.astro']) {
      await mkdir(join(tmpDir, dir), { recursive: true });
      await writeFile(join(tmpDir, dir, 'generated.js'), '');
    }

    const { files } = await pruneDirectory(tmpDir);

    for (const dir of ['.svelte-kit', '.angular', '.turbo', '.expo', '.astro']) {
      assert.ok(!files.some(f => f.includes(dir)), `${dir} should be ignored`);
    }
  });

  it('applies --exclude patterns', async () => {
    await mkdir(join(tmpDir, 'custom-build'), { recursive: true });
    await writeFile(join(tmpDir, 'custom-build', 'output.js'), '');
    await writeFile(join(tmpDir, 'config.js'), 'export default {}');

    const { files } = await pruneDirectory(tmpDir, {
      exclude: ['custom-build/', 'config.js'],
    });

    assert.ok(!files.some(f => f.includes('custom-build')));
    assert.ok(!files.includes('config.js'));
  });

  it('--exclude works with glob patterns', async () => {
    await mkdir(join(tmpDir, 'src', 'gen'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'gen', 'api.ts'), '');
    await writeFile(join(tmpDir, 'src', 'app.ts'), '');

    const { files } = await pruneDirectory(tmpDir, {
      exclude: ['**/gen/'],
    });

    assert.ok(!files.some(f => f.includes('gen')));
    assert.ok(files.some(f => f.includes('app.ts')));
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

  it('returns ignoreFilter from pruneDirectory', async () => {
    const { ignoreFilter } = await pruneDirectory(tmpDir);
    assert.ok(ignoreFilter);
    assert.ok(typeof ignoreFilter.ignores === 'function');
  });

  it('applies --only with exact file path', async () => {
    await writeFile(join(tmpDir, 'keep.py'), 'x=1');
    await writeFile(join(tmpDir, 'skip.py'), 'y=2');

    const { files } = await pruneDirectory(tmpDir, { only: ['keep.py'] });
    assert.ok(files.includes('keep.py'));
    assert.ok(!files.includes('skip.py'));
  });

  it('applies --only with glob pattern', async () => {
    await mkdir(join(tmpDir, 'src', 'api'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'api', 'routes.py'), '');
    await writeFile(join(tmpDir, 'src', 'api', 'models.py'), '');
    await writeFile(join(tmpDir, 'other.js'), '');

    const { files } = await pruneDirectory(tmpDir, { only: ['src/api/*.py'] });
    assert.ok(files.some(f => f.includes('routes.py')));
    assert.ok(files.some(f => f.includes('models.py')));
    assert.ok(!files.includes('other.js'));
  });

  it('returns onlyFilter from pruneDirectory when --only is set', async () => {
    const { onlyFilter } = await pruneDirectory(tmpDir, { only: ['*.py'] });
    assert.ok(onlyFilter);
    assert.ok(typeof onlyFilter.includes === 'function');
  });

  it('returns null onlyFilter when --only is not set', async () => {
    const { onlyFilter } = await pruneDirectory(tmpDir);
    assert.equal(onlyFilter, null);
  });
});

describe('createIgnoreFilter', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fcv-filter-'));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('ignores hardcoded directories', async () => {
    const ig = await createIgnoreFilter(tmpDir);
    assert.ok(ig.ignores('node_modules/dep.js'));
    assert.ok(ig.ignores('.svelte-kit/generated/client.js'));
    assert.ok(ig.ignores('__pycache__/cache.py'));
    assert.ok(ig.ignores('dist/bundle.js'));
  });

  it('ignores lock files', async () => {
    const ig = await createIgnoreFilter(tmpDir);
    assert.ok(ig.ignores('package-lock.json'));
    assert.ok(ig.ignores('yarn.lock'));
  });

  it('does not ignore normal source files', async () => {
    const ig = await createIgnoreFilter(tmpDir);
    assert.ok(!ig.ignores('src/app.js'));
    assert.ok(!ig.ignores('main.py'));
  });

  it('applies --exclude patterns', async () => {
    const ig = await createIgnoreFilter(tmpDir, { exclude: ['admin/captive/'] });
    assert.ok(ig.ignores('admin/captive/index.js'));
    assert.ok(!ig.ignores('admin/main.js'));
  });

  it('loads .gitignore patterns', async () => {
    await writeFile(join(tmpDir, '.gitignore'), 'custom-build/\n');
    const ig = await createIgnoreFilter(tmpDir);
    assert.ok(ig.ignores('custom-build/output.js'));
  });

  it('loads .fcvignore patterns', async () => {
    await writeFile(join(tmpDir, '.fcvignore'), 'generated/\n');
    const ig = await createIgnoreFilter(tmpDir);
    assert.ok(ig.ignores('generated/auto.js'));
  });
});

describe('createOnlyFilter', () => {
  it('returns null for empty patterns', () => {
    assert.equal(createOnlyFilter([]), null);
    assert.equal(createOnlyFilter(null), null);
  });

  it('matches exact file paths', () => {
    const filter = createOnlyFilter(['src/app.py']);
    assert.ok(filter.includes('src/app.py'));
    assert.ok(!filter.includes('src/other.py'));
  });

  it('matches glob patterns', () => {
    const filter = createOnlyFilter(['src/**/*.py']);
    assert.ok(filter.includes('src/app.py'));
    assert.ok(filter.includes('src/utils/helper.py'));
    assert.ok(!filter.includes('lib/thing.js'));
  });

  it('matches multiple patterns', () => {
    const filter = createOnlyFilter(['src/a.py', 'lib/**/*.js']);
    assert.ok(filter.includes('src/a.py'));
    assert.ok(filter.includes('lib/utils/x.js'));
    assert.ok(!filter.includes('src/b.py'));
  });
});
