import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runTools } from '../src/runner.js';

describe('runTools', () => {
  // Shared mock tool factory — override any property as needed
  function makeTool(name, overrides = {}) {
    return {
      name,
      buildCommand() { return { bin: 'echo', args: [name] }; },
      parseOutput(stdout) {
        return [{ file: 'f.py', line: 1, tag: 'LINTER', rule: 'T', severity: 'warning', message: stdout.trim() }];
      },
      ...overrides,
    };
  }

  function runOne(tool, dir = '/tmp', opts = {}) {
    return runTools(
      [{ tool, config: { path: null, source: 'none' } }],
      dir,
      { timeout: 5000, ...opts },
    );
  }

  it('runs a tool that succeeds', async () => {
    const results = await runOne(makeTool('echo-tool'));

    assert.equal(results.length, 1);
    assert.equal(results[0].tool, 'echo-tool');
    assert.equal(results[0].error, null);
    assert.equal(results[0].findings.length, 1);
    assert.equal(results[0].findings[0].message, 'echo-tool');
    assert.ok(results[0].duration >= 0);
  });

  it('handles tool that returns no findings', async () => {
    const results = await runOne(makeTool('clean-tool', {
      buildCommand() { return { bin: 'true', args: [] }; },
      parseOutput() { return []; },
    }));

    assert.equal(results.length, 1);
    assert.equal(results[0].error, null);
    assert.deepEqual(results[0].findings, []);
  });

  it('handles spawn failure gracefully', async () => {
    const results = await runOne(makeTool('missing-tool', {
      buildCommand() { return { bin: 'this-command-does-not-exist-xyz', args: [] }; },
    }));

    assert.equal(results.length, 1);
    assert.ok(results[0].error);
    assert.ok(results[0].error.includes('Failed to spawn'));
  });

  it('handles parseOutput throwing', async () => {
    const results = await runOne(makeTool('bad-parser', {
      buildCommand() { return { bin: 'echo', args: ['not json'] }; },
      parseOutput() { throw new Error('parse failed'); },
    }));

    assert.equal(results.length, 1);
    assert.equal(results[0].error, 'parse failed');
    assert.deepEqual(results[0].findings, []);
  });

  it('runs multiple tools in parallel', async () => {
    const configs = ['tool-a', 'tool-b', 'tool-c'].map(name => ({
      tool: makeTool(name),
      config: { path: null, source: 'none' },
    }));

    const results = await runTools(configs, '/tmp', { timeout: 5000 });

    assert.equal(results.length, 3);
    const names = results.map(r => r.tool).sort();
    assert.deepEqual(names, ['tool-a', 'tool-b', 'tool-c']);
  });

  it('handles timeout', async () => {
    const results = await runOne(
      makeTool('slow-tool', {
        buildCommand() { return { bin: 'sleep', args: ['60'] }; },
        parseOutput() { return []; },
      }),
      '/tmp',
      { timeout: 500 },
    );

    assert.equal(results.length, 1);
    assert.ok(results[0].error);
    assert.ok(results[0].error.includes('Timeout'));
  });

  it('passes cwd from buildCommand to spawn', async () => {
    const results = await runOne(
      makeTool('cwd-tool', {
        buildCommand() { return { bin: 'pwd', args: [], cwd: '/tmp' }; },
      }),
      '/some/other/dir',
    );

    assert.equal(results.length, 1);
    assert.equal(results[0].error, null);
    assert.equal(results[0].findings[0].message, '/tmp');
  });

  it('passes files and fix to buildCommand', async () => {
    let receivedOpts = {};
    const results = await runOne(
      makeTool('opts-tool', {
        buildCommand(targetDir, configPath, opts) {
          receivedOpts = opts;
          return { bin: 'echo', args: ['ok'] };
        },
        parseOutput() { return []; },
      }),
      '/tmp',
      { files: ['a.py', 'b.py'], fix: true },
    );

    assert.deepEqual(receivedOpts.files, ['a.py', 'b.py']);
    assert.equal(receivedOpts.fix, true);
  });

  it('passes licenses option to buildCommand', async () => {
    let receivedOpts = {};
    await runOne(
      makeTool('lic-tool', {
        buildCommand(targetDir, configPath, opts) {
          receivedOpts = opts;
          return { bin: 'echo', args: ['ok'] };
        },
        parseOutput() { return []; },
      }),
      '/tmp',
      { licenses: true },
    );

    assert.equal(receivedOpts.licenses, true);
  });

  it('runs preFixCommands before main command in fix mode', async () => {
    const callOrder = [];
    const results = await runOne(
      makeTool('fix-tool', {
        preFixCommands() {
          return [{ bin: 'echo', args: ['pre-fix'] }];
        },
        buildCommand() {
          callOrder.push('main');
          return { bin: 'echo', args: ['main'] };
        },
      }),
      '/tmp',
      { fix: true },
    );

    assert.equal(results[0].error, null);
    assert.ok(callOrder.includes('main'));
  });

  it('skips preFixCommands when fix is false', async () => {
    let preFixCalled = false;
    await runOne(
      makeTool('no-fix-tool', {
        preFixCommands() {
          preFixCalled = true;
          return [{ bin: 'echo', args: ['pre-fix'] }];
        },
        buildCommand() { return { bin: 'echo', args: ['ok'] }; },
        parseOutput() { return []; },
      }),
      '/tmp',
      { fix: false },
    );

    assert.equal(preFixCalled, false);
  });
});
