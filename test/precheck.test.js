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
