import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { getScanExitCode } from '../src/index.js';
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
