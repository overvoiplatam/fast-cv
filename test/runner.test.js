import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runTools } from '../src/runner.js';

describe('runTools', () => {
  it('runs a tool that succeeds', async () => {
    const mockTool = {
      name: 'echo-tool',
      buildCommand() {
        return { bin: 'echo', args: ['hello'] };
      },
      parseOutput(stdout) {
        return [{ file: 'test.py', line: 1, tag: 'LINTER', rule: 'TEST', severity: 'warning', message: stdout.trim() }];
      },
    };

    const results = await runTools(
      [{ tool: mockTool, config: { path: null, source: 'none' } }],
      '/tmp',
      { timeout: 5000 }
    );

    assert.equal(results.length, 1);
    assert.equal(results[0].tool, 'echo-tool');
    assert.equal(results[0].error, null);
    assert.equal(results[0].findings.length, 1);
    assert.equal(results[0].findings[0].message, 'hello');
    assert.ok(results[0].duration >= 0);
  });

  it('handles tool that returns no findings', async () => {
    const mockTool = {
      name: 'clean-tool',
      buildCommand() { return { bin: 'true', args: [] }; },
      parseOutput() { return []; },
    };

    const results = await runTools(
      [{ tool: mockTool, config: { path: null, source: 'none' } }],
      '/tmp',
      { timeout: 5000 }
    );

    assert.equal(results.length, 1);
    assert.equal(results[0].error, null);
    assert.deepEqual(results[0].findings, []);
  });

  it('handles spawn failure gracefully', async () => {
    const mockTool = {
      name: 'missing-tool',
      buildCommand() { return { bin: 'this-command-does-not-exist-xyz', args: [] }; },
      parseOutput() { return []; },
    };

    const results = await runTools(
      [{ tool: mockTool, config: { path: null, source: 'none' } }],
      '/tmp',
      { timeout: 5000 }
    );

    assert.equal(results.length, 1);
    assert.ok(results[0].error);
    assert.ok(results[0].error.includes('Failed to spawn'));
  });

  it('handles parseOutput throwing', async () => {
    const mockTool = {
      name: 'bad-parser',
      buildCommand() { return { bin: 'echo', args: ['not json'] }; },
      parseOutput() { throw new Error('parse failed'); },
    };

    const results = await runTools(
      [{ tool: mockTool, config: { path: null, source: 'none' } }],
      '/tmp',
      { timeout: 5000 }
    );

    assert.equal(results.length, 1);
    assert.equal(results[0].error, 'parse failed');
    assert.deepEqual(results[0].findings, []);
  });

  it('runs multiple tools in parallel', async () => {
    const makeTool = (name) => ({
      name,
      buildCommand() { return { bin: 'echo', args: [name] }; },
      parseOutput(stdout) {
        return [{ file: 'f.py', line: 1, tag: 'LINTER', rule: 'T', severity: 'warning', message: stdout.trim() }];
      },
    });

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
    const mockTool = {
      name: 'slow-tool',
      buildCommand() { return { bin: 'sleep', args: ['60'] }; },
      parseOutput() { return []; },
    };

    const results = await runTools(
      [{ tool: mockTool, config: { path: null, source: 'none' } }],
      '/tmp',
      { timeout: 500 }  // 500ms timeout
    );

    assert.equal(results.length, 1);
    assert.ok(results[0].error);
    assert.ok(results[0].error.includes('Timeout'));
  });
});
