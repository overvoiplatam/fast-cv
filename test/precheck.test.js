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

  // installHint values below are real executables so tryAutoInstall actually
  // runs (and, for `false`, actually fails) without touching the network.
  it('fails when auto-install leaves every tool unready', async () => {
    const tools = [{
      name: 'ruff',
      extensions: ['.py'],
      installHint: '/usr/bin/true',
      checkInstalled: async () => ({ ok: false, reason: 'unsupported' }),
    }];

    const result = await precheck(tools, { autoInstall: true });
    assert.equal(result.ok, false, 'no ready tool after auto-install must not be a false clean');
    assert.equal(result.tools.length, 0);
    assert.ok(result.message, 'failure carries a message');
    assert.ok(result.message.includes('unsupported'));
    assert.ok(result.warnings.some(w => w.includes('auto-install failed')));
  });

  it('does not count a { ok: false } post-install check as installed', async () => {
    let calls = 0;
    const tool = {
      name: 'eslint',
      extensions: ['.js'],
      installHint: '/usr/bin/true',
      checkInstalled: async () => {
        calls += 1;
        // First call (partition): missing. Second call (after install):
        // present but unusable — must not be counted as installed.
        return calls === 1 ? false : { ok: false, reason: 'unsupported' };
      },
    };

    const result = await precheck([tool], { autoInstall: true });
    assert.ok(calls >= 2, 'the install path re-checks the tool');
    assert.equal(result.tools.length, 0, 'truthy { ok: false } object must not be treated as installed');
    assert.equal(result.ok, false);
  });

  it('stays ok when auto-install recovers at least one tool', async () => {
    let ruffChecks = 0;
    const ruffTool = {
      name: 'ruff',
      extensions: ['.py'],
      installHint: '/usr/bin/true',
      checkInstalled: async () => (ruffChecks++ === 0 ? false : true),
    };
    const knipTool = {
      name: 'knip',
      extensions: ['.js'],
      installHint: '/usr/bin/false',
      checkInstalled: async () => false,
    };

    const result = await precheck([ruffTool, knipTool], { autoInstall: true });
    assert.equal(result.ok, true, 'one ready tool is enough to proceed');
    assert.deepEqual(result.tools.map(t => t.name), ['ruff']);
    assert.ok(result.warnings.some(w => w.includes('knip') && w.includes('auto-install failed')));
  });
});
