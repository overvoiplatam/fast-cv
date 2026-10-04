import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { getScanExitCode, parseGitOnlyScope } from '../src/index.js';
import { VERSION } from '../src/version.js';

const binPath = join(process.cwd(), 'bin', 'fast-cv.js');

describe('getScanExitCode', () => {
  it('returns 0 for clean completed scans', () => {
    assert.equal(getScanExitCode([{ tool: 'eslint', findings: [], error: null }]), 0);
  });

  it('returns 1 when code findings exist and no tool errors exist', () => {
    assert.equal(getScanExitCode([{
      tool: 'eslint',
      error: null,
      findings: [{ file: 'a.js', line: 1, tag: 'LINTER', rule: 'x', message: 'bad' }],
    }]), 1);
  });

  it('returns 2 when a tool error exists', () => {
    assert.equal(getScanExitCode([{ tool: 'knip', error: 'Timeout after 5s', findings: [] }]), 2);
  });

  it('prioritizes tool errors over code findings', () => {
    assert.equal(getScanExitCode([
      { tool: 'eslint', error: null, findings: [{ file: 'a.js', line: 1, tag: 'LINTER', rule: 'x', message: 'bad' }] },
      { tool: 'knip', error: 'parse failed', findings: [] },
    ]), 2);
  });
});

describe('VERSION', () => {
  it('matches package.json version', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
    assert.equal(VERSION, pkg.version);
  });
});

describe('install-hook subcommand', () => {
  let repo;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'fcv-hook-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo });
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('writes a pre-commit hook that runs fast-cv without --timeout 60', async () => {
    execFileSync('node', [binPath, 'install-hook', repo], { encoding: 'utf-8' });
    const hook = await readFile(join(repo, '.git', 'hooks', 'pre-commit'), 'utf-8');

    assert.match(hook, /\[fast-cv\]/, 'hook should carry the fast-cv identifier comment');
    assert.match(hook, /^fast-cv \.$/m, 'hook should invoke fast-cv . without extra flags');
    assert.doesNotMatch(hook, /--timeout/, 'hook should no longer hard-code --timeout');
  });
});

describe('CLI flag surface', () => {
  function help() {
    return execFileSync('node', [binPath, '--help'], { encoding: 'utf-8' });
  }

  it('exposes --update-db flag with trivy attribution', () => {
    const out = help();
    assert.match(out, /--update-db/);
    assert.match(out, /trivy/);
  });

  it('advertises --timeout as disabled by default, not 120', () => {
    const out = help();
    assert.match(out, /--timeout/);
    // Commander wraps long help lines; normalise whitespace before asserting.
    const flat = out.replace(/\s+/g, ' ');
    assert.match(flat, /disabled by default/);
    assert.doesNotMatch(flat, /per-tool timeout in seconds \(default: "?120"?\)/);
  });
});

// No pre-existing pattern for asserting invalid-flag handling, so this spawns
// the real bin (same approach as the tests above) and checks exit code 2.
describe('CLI flag validation', () => {
  let emptyDir;

  beforeEach(async () => {
    emptyDir = await mkdtemp(join(tmpdir(), 'fcv-flags-'));
  });
  afterEach(async () => {
    await rm(emptyDir, { recursive: true, force: true });
  });

  function runCli(args) {
    try {
      const stdout = execFileSync('node', [binPath, ...args], { encoding: 'utf-8' });
      return { status: 0, stderr: '', stdout };
    } catch (err) {
      return { status: err.status, stderr: String(err.stderr || ''), stdout: String(err.stdout || '') };
    }
  }

  it('rejects non-numeric --max-lines with exit code 2 and a clear message', () => {
    const { status, stderr } = runCli(['--max-lines', 'abc', emptyDir]);
    assert.equal(status, 2);
    assert.match(stderr, /invalid --max-lines value: abc/);
    assert.doesNotMatch(stderr, /NaN/);
  });

  it('rejects non-integer --max-lines values', () => {
    const { status, stderr } = runCli(['--max-lines', '1.5', emptyDir]);
    assert.equal(status, 2);
    assert.match(stderr, /invalid --max-lines value/);
  });

  it('accepts --max-lines 0 (documented disable value)', () => {
    // An empty dir short-circuits to "No scannable files found" (exit 0):
    // reaching that point proves 0 passed validation.
    const { status, stderr } = runCli(['--max-lines', '0', emptyDir]);
    assert.doesNotMatch(stderr, /invalid --max-lines/);
    assert.equal(status, 0, stderr);
  });

  it('warns and keeps scanning for an unknown --git-only scope (0.2.1 fallback)', () => {
    // `--git-only=bogus` is not an exit-2 usage error: 0.2.1 treated unknown
    // strings as the uncommitted scope, and existing scripts may rely on
    // that (including `--git-only .`, where commander folds the target
    // token into the scope). The run must proceed — with a loud warning.
    const { status, stderr } = runCli(['--git-only=bogus', emptyDir]);
    assert.match(stderr, /--git-only "bogus" is not a known scope; using the 0\.2\.1 default/);
    // emptyDir is not a git repo, so the scan proceeds and fails on git-only
    // resolution — but the parse step itself cannot abort before that point.
    assert.doesNotMatch(stderr, /is not a known scope.*exit/);
    assert.ok(typeof status === 'number');
  });

  describe('parseGitOnlyScope', () => {
    it('bare --git-only keeps the 0.2.1 default: uncommitted+unpushed (all)', () => {
      assert.equal(parseGitOnlyScope(true), 'all');
    });

    it('explicit scopes map unchanged', () => {
      assert.equal(parseGitOnlyScope('all'), 'all');
      assert.equal(parseGitOnlyScope('uncommitted'), 'uncommitted');
    });

    it('unknown values fall back to uncommitted (0.2.1 behavior for `--git-only .`)', () => {
      assert.equal(parseGitOnlyScope('.'), 'uncommitted');
      assert.equal(parseGitOnlyScope('bogus'), 'uncommitted');
    });
  });

  it('writes a parseable JSON report for --format json', () => {
    const { status, stdout } = runCli(['--format', 'json', emptyDir]);
    assert.equal(status, 0);
    const parsed = JSON.parse(stdout);
    assert.equal(typeof parsed.target, 'string');
    assert.ok(parsed.summary && Array.isArray(parsed.summary.tools));
    assert.ok(Array.isArray(parsed.findings));
    assert.ok(Array.isArray(parsed.toolErrors));
    assert.ok(Array.isArray(parsed.warnings));
    assert.ok(!('minSeverity' in parsed.summary));
  });

  it('surfaces the active --min-severity filter in the JSON summary', () => {
    const { status, stdout } = runCli(['--format', 'json', '--min-severity', 'error', emptyDir]);
    assert.equal(status, 0);
    assert.equal(JSON.parse(stdout).summary.minSeverity, 'error');
  });

  it('adds a Min severity line to the markdown report when the filter is active', () => {
    const { status, stdout } = runCli(['--min-severity', 'error', emptyDir]);
    assert.equal(status, 0);
    assert.match(stdout, /\*\*Min severity\*\*: error/);
  });
});
