import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import clippy from '../../src/tools/clippy.js';

describe('clippy adapter', () => {
  it('has correct metadata', () => {
    assert.equal(clippy.name, 'clippy');
    assert.deepEqual(clippy.extensions, ['.rs']);
    assert.ok(clippy.installHint.includes('clippy'));
  });

  it('builds command with cargo clippy (no config adds -W missing-docs)', () => {
    const { bin, args, cwd } = clippy.buildCommand('/tmp/rust-project', null);
    assert.equal(bin, 'cargo');
    assert.ok(args.includes('clippy'));
    assert.ok(args.includes('--message-format=json'));
    assert.ok(args.includes('--all-targets'));
    assert.ok(args.includes('--all-features'));
    assert.ok(args.includes('--'));
    assert.ok(args.includes('--no-deps'));
    assert.ok(args.includes('-W'));
    assert.ok(args.includes('missing-docs'));
    assert.equal(cwd, '/tmp/rust-project');
  });

  it('builds command with config (no -W missing-docs)', () => {
    const { args } = clippy.buildCommand('/tmp/rust-project', '/etc/clippy.toml');
    assert.ok(!args.includes('-W'));
    assert.ok(!args.includes('missing-docs'));
  });

  it('builds command with --fix', () => {
    const { args } = clippy.buildCommand('/tmp/project', null, { fix: true });
    assert.ok(args.includes('--fix'));
    assert.ok(args.includes('--allow-dirty'));
    assert.ok(args.includes('--allow-staged'));
  });

  it('parses JSON Lines output with compiler-message', () => {
    const lines = [
      JSON.stringify({
        reason: 'compiler-artifact',
        target: { name: 'mycrate' },
      }),
      JSON.stringify({
        reason: 'compiler-message',
        message: {
          level: 'warning',
          message: 'unused variable: `x`',
          code: { code: 'unused_variables' },
          spans: [{ file_name: 'src/main.rs', line_start: 10, column_start: 9, is_primary: true }],
        },
      }),
      JSON.stringify({
        reason: 'compiler-message',
        message: {
          level: 'error',
          message: 'mismatched types',
          code: { code: 'clippy::correctness_issue' },
          spans: [
            { file_name: 'src/lib.rs', line_start: 5, column_start: 3, is_primary: false },
            { file_name: 'src/lib.rs', line_start: 20, column_start: 15, is_primary: true },
          ],
        },
      }),
      JSON.stringify({ reason: 'build-finished', success: true }),
    ];
    const stdout = lines.join('\n');

    const findings = clippy.parseOutput(stdout, '', 0);
    assert.equal(findings.length, 2);

    assert.equal(findings[0].file, 'src/main.rs');
    assert.equal(findings[0].line, 10);
    assert.equal(findings[0].col, 9);
    assert.equal(findings[0].rule, 'unused_variables');
    assert.equal(findings[0].severity, 'warning');
    assert.equal(findings[0].tag, 'LINTER');

    // Primary span should be used (line 20, not 5)
    assert.equal(findings[1].file, 'src/lib.rs');
    assert.equal(findings[1].line, 20);
    assert.equal(findings[1].col, 15);
    assert.equal(findings[1].severity, 'error');
    assert.equal(findings[1].tag, 'BUG'); // correctness keyword
  });

  it('classifies lint names correctly', () => {
    const make = (code, level = 'warning') => [
      JSON.stringify({
        reason: 'compiler-message',
        message: {
          level,
          message: 'test',
          code: { code },
          spans: [{ file_name: 'f.rs', line_start: 1, column_start: 1, is_primary: true }],
        },
      }),
    ].join('\n');

    assert.equal(clippy.parseOutput(make('clippy::correctness_check'), '', 0)[0].tag, 'BUG');
    assert.equal(clippy.parseOutput(make('clippy::suspicious_op'), '', 0)[0].tag, 'BUG');
    assert.equal(clippy.parseOutput(make('clippy::perf_issue'), '', 0)[0].tag, 'REFACTOR');
    assert.equal(clippy.parseOutput(make('clippy::complexity_thing'), '', 0)[0].tag, 'REFACTOR');
    assert.equal(clippy.parseOutput(make('clippy::style_check'), '', 0)[0].tag, 'LINTER');
    assert.equal(clippy.parseOutput(make('missing_docs'), '', 0)[0].tag, 'DOCS');
  });

  it('returns empty for clean output', () => {
    assert.deepEqual(clippy.parseOutput('', '', 0), []);
  });

  it('filters out note-level messages', () => {
    const stdout = JSON.stringify({
      reason: 'compiler-message',
      message: {
        level: 'note',
        message: 'some help text',
        code: null,
        spans: [{ file_name: 'f.rs', line_start: 1, column_start: 1, is_primary: true }],
      },
    });
    const findings = clippy.parseOutput(stdout, '', 0);
    assert.equal(findings.length, 0);
  });

  it('throws on fatal exit code >= 101', () => {
    assert.throws(
      () => clippy.parseOutput('', 'error: could not compile', 101),
      /clippy error/
    );
  });

  it('checkInstalled returns boolean', async () => {
    const result = await clippy.checkInstalled();
    assert.equal(typeof result, 'boolean');
  });
});
