import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { getGitChangedFiles } from '../src/git-changes.js';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

/** Create a temp dir with a git repo containing one committed file (a.js). */
async function makeRepo(prefix = 'fcv-git-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  git(['init'], dir);
  git(['config', 'user.email', 'test@test.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  await writeFile(join(dir, 'a.js'), 'x');
  git(['add', '.'], dir);
  git(['commit', '-m', 'init'], dir);
  return dir;
}

describe('getGitChangedFiles', () => {
  let repo;

  beforeEach(async () => { repo = await makeRepo(); });
  afterEach(async () => { await rm(repo, { recursive: true, force: true }); });

  it('throws for non-git directory', async () => {
    const nonGit = await mkdtemp(join(tmpdir(), 'fcv-nogit-'));
    try {
      await assert.rejects(() => getGitChangedFiles(nonGit), /Not a git repository/);
    } finally {
      await rm(nonGit, { recursive: true, force: true });
    }
  });

  it('returns empty array for clean tree', async () => {
    const files = await getGitChangedFiles(repo);
    assert.deepEqual(files, []);
  });

  it('detects untracked files', async () => {
    await writeFile(join(repo, 'new.py'), 'print("hi")');
    const files = await getGitChangedFiles(repo);
    assert.ok(files.includes('new.py'));
  });

  it('detects modified files', async () => {
    await writeFile(join(repo, 'a.js'), 'changed');
    const files = await getGitChangedFiles(repo);
    assert.ok(files.includes('a.js'));
  });

  it('detects staged files', async () => {
    await writeFile(join(repo, 'staged.py'), 'y');
    git(['add', 'staged.py'], repo);
    const files = await getGitChangedFiles(repo);
    assert.ok(files.includes('staged.py'));
  });

  it('skips deleted files', async () => {
    await writeFile(join(repo, 'b.js'), 'y');
    git(['add', 'b.js'], repo);
    git(['commit', '-m', 'add b'], repo);
    git(['rm', 'b.js'], repo);
    const files = await getGitChangedFiles(repo);
    assert.ok(!files.includes('b.js'));
  });

  it('deduplicates files', async () => {
    // Modify and stage the same file — appears in both staged and unstaged
    await writeFile(join(repo, 'a.js'), 'changed');
    git(['add', 'a.js'], repo);
    await writeFile(join(repo, 'a.js'), 'changed again');
    const files = await getGitChangedFiles(repo);
    assert.equal(files.filter(f => f === 'a.js').length, 1);
  });

  it('handles subdirectory targets', async () => {
    await mkdir(join(repo, 'src'), { recursive: true });
    await writeFile(join(repo, 'src', 'b.js'), 'x');
    git(['add', '.'], repo);
    git(['commit', '-m', 'add src'], repo);

    await writeFile(join(repo, 'src', 'b.js'), 'changed');
    await writeFile(join(repo, 'a.js'), 'changed');

    // Target the src/ subdirectory — should only return files inside src/
    const files = await getGitChangedFiles(join(repo, 'src'));
    assert.ok(files.includes('b.js'));
    assert.ok(!files.includes('a.js'));
  });

  it('uncommitted scope returns working tree changes', async () => {
    await writeFile(join(repo, 'new.py'), 'y');
    const allFiles = await getGitChangedFiles(repo, 'all');
    const uncommittedFiles = await getGitChangedFiles(repo, 'uncommitted');
    assert.ok(allFiles.includes('new.py'));
    assert.ok(uncommittedFiles.includes('new.py'));
  });
});
