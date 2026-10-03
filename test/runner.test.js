import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { runTools } from '../src/runner.js';

// On macOS /tmp is a symlink to /private/tmp; getcwd() inside the spawned
// process returns the canonical path, so we compare against that.
const TMP_CANONICAL = realpathSync('/tmp');

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

  it('runs multiple tools sequentially', async () => {
    const configs = ['tool-a', 'tool-b', 'tool-c'].map(name => ({
      tool: makeTool(name),
      config: { path: null, source: 'none' },
    }));

    const results = await runTools(configs, '/tmp', { timeout: 5000 });

    assert.equal(results.length, 3);
    const names = results.map(r => r.tool).sort();
    assert.deepEqual(names, ['tool-a', 'tool-b', 'tool-c']);
  });

  it('runs tools in sequential order', async () => {
    const order = [];
    const configs = ['first', 'second', 'third'].map(name => ({
      tool: makeTool(name, {
        buildCommand() { order.push(name); return { bin: 'echo', args: [name] }; },
      }),
      config: { path: null, source: 'none' },
    }));
    await runTools(configs, '/tmp', { timeout: 5000 });
    assert.deepEqual(order, ['first', 'second', 'third']);
  });

  it('logs progress when verbose is true', async () => {
    const written = [];
    const origWrite = process.stderr.write;
    process.stderr.write = (msg) => { written.push(msg); return true; };
    try {
      await runTools(
        [{ tool: makeTool('verb-tool'), config: { path: null, source: 'none' } }],
        '/tmp', { timeout: 5000, verbose: true },
      );
    } finally {
      process.stderr.write = origWrite;
    }
    assert.ok(written.some(m => m.includes('Running verb-tool')));
    assert.ok(written.some(m => m.includes('verb-tool done')));
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

  // Uses node:test mock timers (no real waiting): the timeout fires via
  // tick(), a real child process is killed for real, and process.kill is
  // spied to assert no late SIGKILL is issued after close (PID-reuse risk).
  it('timeout kills the child and never issues a late kill after close', async (t) => {
    const killCalls = [];
    const realKill = process.kill.bind(process);
    process.kill = (...args) => { killCalls.push(args); return realKill(...args); };
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pending = runOne(
        makeTool('hang-tool', {
          buildCommand() { return { bin: 'node', args: ['-e', 'setTimeout(() => {}, 60000)'] }; },
          parseOutput() { return []; },
        }),
        '/tmp',
        { timeout: 1000 },
      );
      t.mock.timers.tick(1000); // fire the per-tool timeout → SIGTERM
      const results = await pending;

      assert.ok(results[0].error && results[0].error.includes('Timeout'));
      assert.equal(killCalls.length, 1, 'exactly one SIGTERM');
      assert.ok(killCalls[0][0] < 0, 'POSIX kill targets the process group (negative pid)');
      assert.equal(killCalls[0][1], 'SIGTERM');

      // The 5s SIGKILL escalation must have been cancelled by close: ticking
      // past it must produce no further kill against a possibly-recycled PID.
      t.mock.timers.tick(5000);
      assert.equal(killCalls.length, 1, 'no late SIGKILL after close');
    } finally {
      t.mock.timers.reset();
      process.kill = realKill;
    }
  });

  it('does not apply a timeout when none is configured', async () => {
    const results = await runTools(
      [{
        tool: makeTool('short-tool', {
          buildCommand() { return { bin: 'node', args: ['-e', 'setTimeout(() => {}, 25)'] }; },
          parseOutput() { return []; },
        }),
        config: { path: null, source: 'none' },
      }],
      '/tmp',
      {},
    );

    assert.equal(results.length, 1);
    assert.equal(results[0].error, null);
  });

  it('passes cwd from buildCommand to spawn', async () => {
    const results = await runOne(
      makeTool('cwd-tool', {
        buildCommand() { return { bin: 'pwd', args: [], cwd: TMP_CANONICAL }; },
      }),
      '/some/other/dir',
    );

    assert.equal(results.length, 1);
    assert.equal(results[0].error, null);
    assert.equal(results[0].findings[0].message, TMP_CANONICAL);
  });

  it('passes files and fix to buildCommand', async () => {
    let receivedOpts = {};
    await runOne(
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

  // Tool that records what `files` it was invoked with. Used to assert that
  // the runner-level extension filter is applied before buildCommand sees it.
  function fileCapturingTool(name, extraOverrides = {}) {
    const captured = { files: undefined };
    const tool = makeTool(name, {
      buildCommand(td, cp, opts) { captured.files = opts.files; return { bin: 'echo', args: ['ok'] }; },
      parseOutput() { return []; },
      ...extraOverrides,
    });
    return { tool, captured };
  }

  it('filters files by tool.extensions before invoking buildCommand', async () => {
    const { tool, captured } = fileCapturingTool('py-only', { extensions: ['.py', '.pyi'] });
    await runOne(tool, '/tmp', { files: ['a.py', 'b.yml', 'c.pyi', 'd.ts', 'e.md'] });
    assert.deepEqual(captured.files, ['a.py', 'c.pyi']);
  });

  it('passes files unchanged when tool has no extensions field', async () => {
    const { tool, captured } = fileCapturingTool('no-ext');
    await runOne(tool, '/tmp', { files: ['a.py', 'b.yml'] });
    assert.deepEqual(captured.files, ['a.py', 'b.yml']);
  });

  it('passes filtered files (not raw files) to preFixCommands', async () => {
    let receivedPreFixFiles;
    await runOne(
      makeTool('fix-with-ext', {
        extensions: ['.py'],
        preFixCommands(td, cp, opts) {
          receivedPreFixFiles = opts.files;
          return [{ bin: 'echo', args: ['pre'] }];
        },
        buildCommand() { return { bin: 'echo', args: ['main'] }; },
        parseOutput() { return []; },
      }),
      '/tmp',
      { files: ['a.py', 'b.yml'], fix: true },
    );

    assert.deepEqual(receivedPreFixFiles, ['a.py']);
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

  it('runs updateDbCommands before main command when updateDb=true', async () => {
    const callOrder = [];
    const results = await runOne(
      makeTool('update-db-tool', {
        updateDbCommands() {
          callOrder.push('db-update');
          return [{ bin: 'true', args: [] }];
        },
        buildCommand() {
          callOrder.push('main');
          return { bin: 'echo', args: ['ok'] };
        },
        parseOutput() { return []; },
      }),
      '/tmp',
      { updateDb: true },
    );

    assert.equal(results[0].error, null);
    assert.deepEqual(callOrder, ['db-update', 'main']);
  });

  it('skips updateDbCommands when updateDb is false', async () => {
    let dbUpdateCalled = false;
    await runOne(
      makeTool('no-update-tool', {
        updateDbCommands() {
          dbUpdateCalled = true;
          return [{ bin: 'true', args: [] }];
        },
        buildCommand() { return { bin: 'echo', args: ['ok'] }; },
        parseOutput() { return []; },
      }),
      '/tmp',
      { updateDb: false },
    );

    assert.equal(dbUpdateCalled, false);
  });

  it('reports error and skips scan when a DB update command fails', async () => {
    let mainRan = false;
    const results = await runOne(
      makeTool('failing-db-tool', {
        updateDbCommands() {
          return [{ bin: 'sh', args: ['-c', 'echo "download failed" >&2; exit 1'] }];
        },
        buildCommand() {
          mainRan = true;
          return { bin: 'echo', args: ['ok'] };
        },
        parseOutput() { return []; },
      }),
      '/tmp',
      { updateDb: true },
    );

    assert.equal(mainRan, false);
    assert.ok(results[0].error.includes('failing-db-tool DB update failed'));
    assert.ok(results[0].error.includes('download failed'));
  });

  it('reports DB update failure even when the command emits no stderr', async () => {
    const results = await runOne(
      makeTool('silent-db-tool', {
        updateDbCommands() {
          return [{ bin: 'sh', args: ['-c', 'exit 3'] }];
        },
        buildCommand() { return { bin: 'echo', args: ['ok'] }; },
        parseOutput() { return []; },
      }),
      '/tmp',
      { updateDb: true },
    );

    assert.ok(results[0].error.includes('silent-db-tool DB update failed'));
    assert.ok(results[0].error.includes('exit code 3'));
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

  // Helper: run a fix-capturing tool with a given config source
  async function runFixGated(source, toolOverrides = {}) {
    let receivedFix;
    const results = await runTools(
      [{ tool: makeTool(`${source}-tool`, {
        buildCommand(td, cp, opts) { receivedFix = opts.fix; return { bin: 'echo', args: ['ok'] }; },
        parseOutput() { return []; },
        ...toolOverrides,
      }), config: { path: `/cfg/${source}`, source } }],
      '/tmp',
      { timeout: 5000, fix: true },
    );
    return { receivedFix, results };
  }

  it('skips semantic fix when config source is package-default', async () => {
    const { receivedFix, results } = await runFixGated('package-default');
    assert.equal(receivedFix, false);
    assert.equal(results[0].fixSkipped, true);
  });

  it('applies semantic fix when config source is local', async () => {
    const { receivedFix, results } = await runFixGated('local');
    assert.equal(receivedFix, true);
    assert.equal(results[0].fixSkipped, false);
  });

  it('still runs preFixCommands when config source is package-default', async () => {
    let preFixRan = false;
    const { receivedFix } = await runFixGated('package-default', {
      preFixCommands() { preFixRan = true; return [{ bin: 'echo', args: ['format'] }]; },
    });
    assert.equal(preFixRan, true);
    assert.equal(receivedFix, false);
  });

  it('applies semantic fix when config source is user-default', async () => {
    const { receivedFix, results } = await runFixGated('user-default');
    assert.equal(receivedFix, true);
    assert.equal(results[0].fixSkipped, false);
  });
});
