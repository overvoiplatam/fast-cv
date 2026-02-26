import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveConfig } from '../src/config-resolver.js';

describe('resolveConfig', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fcv-config-'));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns local config when present', async () => {
    await writeFile(join(tmpDir, 'ruff.toml'), '[lint]\nselect = ["E"]\n');
    const result = await resolveConfig('ruff', tmpDir);
    assert.equal(result.source, 'local');
    assert.equal(result.path, join(tmpDir, 'ruff.toml'));
  });

  it('falls back to package default when no local config', async () => {
    // Use a fresh dir with no local config
    const freshDir = await mkdtemp(join(tmpdir(), 'fcv-config-fresh-'));
    try {
      const result = await resolveConfig('ruff', freshDir);
      // Falls back through: user-default (if ~/.config/fast-cv exists) → package-default → none
      assert.ok(['user-default', 'package-default', 'none'].includes(result.source));
    } finally {
      await rm(freshDir, { recursive: true, force: true });
    }
  });

  it('returns none for unknown tools', async () => {
    const result = await resolveConfig('nonexistent-tool', tmpDir);
    assert.equal(result.source, 'none');
    assert.equal(result.path, null);
  });

  it('returns none for tools without package defaults', async () => {
    const freshDir = await mkdtemp(join(tmpdir(), 'fcv-config-nodef-'));
    try {
      const result = await resolveConfig('bearer', freshDir);
      assert.equal(result.source, 'none');
      assert.equal(result.path, null);
    } finally {
      await rm(freshDir, { recursive: true, force: true });
    }
  });

  it('prefers first matching local config', async () => {
    // ruff.toml should take precedence over pyproject.toml
    await writeFile(join(tmpDir, 'pyproject.toml'), '[tool.ruff]\n');
    // ruff.toml already exists from earlier test
    const result = await resolveConfig('ruff', tmpDir);
    assert.equal(result.source, 'local');
    assert.ok(result.path.endsWith('ruff.toml'));
  });

  it('detects eslint config files', async () => {
    await writeFile(join(tmpDir, '.eslintrc.json'), '{}');
    const result = await resolveConfig('eslint', tmpDir);
    assert.equal(result.source, 'local');
    assert.ok(result.path.endsWith('.eslintrc.json'));
  });
});
