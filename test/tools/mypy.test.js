import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mypy from '../../src/tools/mypy.js';
import { testBuildCommandWithFiles } from '../helpers.js';

describe('mypy adapter', () => {
  it('has correct metadata', () => {
    assert.equal(mypy.name, 'mypy');
    assert.deepEqual(mypy.extensions, ['.py', '.pyi']);
    assert.ok(mypy.installHint.includes('mypy'));
  });

  it('builds correct command without config', () => {
    const { bin, args } = mypy.buildCommand('/tmp/project', null);
    assert.equal(bin, 'mypy');
    assert.ok(args.includes('--output'));
    assert.ok(args.includes('json'));
    assert.ok(args.includes('--no-error-summary'));
    assert.ok(args.includes('/tmp/project'));
    assert.ok(!args.includes('--config-file'));
  });

  it('builds correct command with config', () => {
    const { args } = mypy.buildCommand('/tmp/project', '/etc/mypy.ini');
    assert.ok(args.includes('--config-file'));
    assert.ok(args.includes('/etc/mypy.ini'));
  });

  it('builds command with files list', () => {
    testBuildCommandWithFiles(mypy);
  });

  it('parses JSON Lines output', () => {
    const lines = [
      JSON.stringify({ file: 'src/app.py', line: 42, column: 5, message: 'Incompatible types in assignment', code: 'assignment', severity: 'error' }),
      JSON.stringify({ file: 'src/app.py', line: 50, column: 10, message: 'Argument 1 has incompatible type', code: 'arg-type', severity: 'error' }),
    ];
    const stdout = lines.join('\n');

    const findings = mypy.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 2);

    assert.equal(findings[0].file, 'src/app.py');
    assert.equal(findings[0].line, 42);
    assert.equal(findings[0].col, 5);
    assert.equal(findings[0].tag, 'TYPE_ERROR');
    assert.equal(findings[0].rule, 'assignment');
    assert.equal(findings[0].severity, 'error');

    assert.equal(findings[1].rule, 'arg-type');
  });

  it('filters out non-error severity (notes)', () => {
    const lines = [
      JSON.stringify({ file: 'src/app.py', line: 42, message: 'Type error', code: 'arg-type', severity: 'error' }),
      JSON.stringify({ file: 'src/app.py', line: 43, message: 'See hint', code: 'arg-type', severity: 'note' }),
      JSON.stringify({ file: 'src/app.py', line: 44, message: 'Some warning', code: 'misc', severity: 'warning' }),
    ];
    const stdout = lines.join('\n');

    const findings = mypy.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].line, 42);
  });

  it('tag is always TYPE_ERROR', () => {
    const stdout = JSON.stringify({ file: 'x.py', line: 1, message: 'test', code: 'override', severity: 'error' });
    const findings = mypy.parseOutput(stdout, '', 1);
    assert.equal(findings[0].tag, 'TYPE_ERROR');
  });

  it('returns empty array for clean output', () => {
    assert.deepEqual(mypy.parseOutput('', '', 0), []);
  });

  it('throws on mypy error (exit code 2 with stderr)', () => {
    assert.throws(
      () => mypy.parseOutput('', 'mypy: error: No module named foo', 2),
      /mypy error/
    );
  });

  it('handles missing column gracefully', () => {
    const stdout = JSON.stringify({ file: 'x.py', line: 5, message: 'error msg', code: 'misc', severity: 'error' });
    const findings = mypy.parseOutput(stdout, '', 1);
    assert.equal(findings[0].col, undefined);
  });

  it('skips unparseable lines', () => {
    const stdout = 'not json\n' + JSON.stringify({ file: 'x.py', line: 1, message: 'ok', code: 'misc', severity: 'error' });
    const findings = mypy.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 1);
  });

  it('checkInstalled returns boolean', async () => {
    const result = await mypy.checkInstalled();
    assert.equal(typeof result, 'boolean');
  });
});
