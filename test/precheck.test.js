import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { precheck } from '../src/precheck.js';

describe('precheck', () => {
  it('returns ok when all tools are installed', async () => {
    const tools = [
      { name: 'tool-a', extensions: ['.py'], installHint: 'pip install a', checkInstalled: async () => true },
      { name: 'tool-b', extensions: ['.js'], installHint: 'npm install b', checkInstalled: async () => true },
    ];

    const result = await precheck(tools);
    assert.equal(result.ok, true);
    assert.equal(result.tools.length, 2);
  });

  it('skips missing tools gracefully when some are available', async () => {
    const tools = [
      { name: 'tool-a', extensions: ['.py'], installHint: 'pip install a', checkInstalled: async () => true },
      { name: 'tool-b', extensions: ['.js'], installHint: 'npm install b', checkInstalled: async () => false },
    ];

    const result = await precheck(tools);
    assert.equal(result.ok, true);
    // Only the installed tool is in ready list
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, 'tool-a');
    // Missing tool produces a warning
    assert.ok(result.warnings.some(w => w.includes('tool-b')));
    assert.ok(result.warnings.some(w => w.includes('npm install b')));
  });

  // Present but unusable: checkInstalled reports why instead of just `false`.
  const UNUSABLE_REASON = 'found v6.4.0, but flat config needs eslint >= 9';
  const unusableEslint = () => ({
    name: 'eslint',
    extensions: ['.js'],
    installHint: 'npm install -g eslint',
    checkInstalled: async () => ({ ok: false, reason: UNUSABLE_REASON }),
  });

  it('surfaces the reason when a tool is present but unusable', async () => {
    const tools = [
      { name: 'tool-a', extensions: ['.py'], installHint: 'pip install a', checkInstalled: async () => true },
      unusableEslint(),
    ];

    const result = await precheck(tools);
    assert.equal(result.tools.length, 1);
    const warning = result.warnings.find(w => w.includes('eslint'));
    assert.ok(warning.includes('found v6.4.0'));
    assert.ok(!warning.includes('not found'), 'the misleading default is replaced');
  });

  it('treats { ok: true } as installed', async () => {
    const tools = [
      { name: 'tool-a', extensions: ['.py'], installHint: 'pip install a', checkInstalled: async () => ({ ok: true }) },
    ];

    const result = await precheck(tools);
    assert.equal(result.ok, true);
    assert.equal(result.tools.length, 1);
  });

  it('includes the unusable reason in the all-missing failure message', async () => {
    const result = await precheck([unusableEslint()]);
    assert.equal(result.ok, false);
    assert.ok(result.message.includes('found v6.4.0'));
  });

  it('includes extension info in failure message', async () => {
    const tools = [
      { name: 'ruff', extensions: ['.py', '.pyi'], installHint: 'pip3 install ruff', checkInstalled: async () => false },
    ];

    const result = await precheck(tools);
    assert.equal(result.ok, false);
    assert.ok(result.message.includes('.py, .pyi'));
  });

  it('suggests --auto-install in failure message', async () => {
    const tools = [
      { name: 'ruff', extensions: ['.py'], installHint: 'pip3 install ruff', checkInstalled: async () => false },
    ];

    const result = await precheck(tools);
    assert.ok(result.message.includes('--auto-install'));
  });

  it('handles checkInstalled throwing', async () => {
    const tools = [
      { name: 'broken', extensions: ['.py'], installHint: 'test', checkInstalled: async () => { throw new Error('boom'); } },
    ];

    const result = await precheck(tools);
    // Should treat as missing, not crash
    assert.equal(result.ok, false);
  });

  it('returns empty tools when all missing and no auto-install', async () => {
    const tools = [
      { name: 'a', extensions: ['.py'], installHint: 'install a', checkInstalled: async () => false },
      { name: 'b', extensions: ['.js'], installHint: 'install b', checkInstalled: async () => false },
    ];

    const result = await precheck(tools);
    assert.equal(result.ok, false);
    assert.equal(result.tools.length, 0);
  });
});
