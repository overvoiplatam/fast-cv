import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mypy from '../../src/tools/mypy.js';
import { testBuildCommandWithFiles } from '../helpers.js';

// Asserts the canonical Finding shape mypy adapters emit. Shared between
// JSON-mode and text-mode tests since both must produce identical findings.
function assertFindingShape(f, { file, line, col, rule, severity = 'error' }) {
  assert.equal(f.file, file);
  assert.equal(f.line, line);
  assert.equal(f.col, col);
  assert.equal(f.tag, 'TYPE_ERROR');
  assert.equal(f.rule, rule);
  assert.equal(f.severity, severity);
}

function assertSingleErrorAtLine(stdout, line) {
  const findings = mypy.parseOutput(stdout, '', 1);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, line);
  return findings[0];
}

describe('mypy adapter (metadata)', () => {
  it('has correct metadata', () => {
    assert.equal(mypy.name, 'mypy');
    assert.deepEqual(mypy.extensions, ['.py', '.pyi']);
    assert.ok(mypy.installHint.includes('mypy'));
  });

  it('checkInstalled returns boolean', async () => {
    const result = await mypy.checkInstalled();
    assert.equal(typeof result, 'boolean');
  });
});

describe('mypy adapter (json mode — mypy >= 1.11)', () => {
  before(() => mypy._setJsonSupportForTests(true));
  after(() => mypy._setJsonSupportForTests(false));

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
    assertFindingShape(findings[0], { file: 'src/app.py', line: 42, col: 5, rule: 'assignment' });
    assert.equal(findings[1].rule, 'arg-type');
  });

  it('filters out non-error severity (notes)', () => {
    const stdout = [
      JSON.stringify({ file: 'src/app.py', line: 42, message: 'Type error', code: 'arg-type', severity: 'error' }),
      JSON.stringify({ file: 'src/app.py', line: 43, message: 'See hint', code: 'arg-type', severity: 'note' }),
      JSON.stringify({ file: 'src/app.py', line: 44, message: 'Some warning', code: 'misc', severity: 'warning' }),
    ].join('\n');
    assertSingleErrorAtLine(stdout, 42);
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
});

describe('mypy adapter (text mode — mypy < 1.11)', () => {
  before(() => mypy._setJsonSupportForTests(false));
  after(() => mypy._setJsonSupportForTests(false));

  it('buildCommand omits --output/json', () => {
    const { args } = mypy.buildCommand('/tmp/project', null);
    assert.ok(!args.includes('--output'));
    assert.ok(!args.includes('json'));
    assert.ok(args.includes('--no-error-summary'));
    assert.ok(args.includes('/tmp/project'));
  });

  it('parses plain-text error with line and column', () => {
    const stdout = 'src/app.py:42:5: error: Incompatible types in assignment  [assignment]\n';
    const findings = mypy.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 1);
    assertFindingShape(findings[0], { file: 'src/app.py', line: 42, col: 5, rule: 'assignment' });
    assert.equal(findings[0].message, 'Incompatible types in assignment');
  });

  it('parses plain-text error with line only (no column)', () => {
    const stdout = 'src/app.py:42: error: Some problem  [misc]\n';
    const findings = mypy.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].line, 42);
    assert.equal(findings[0].col, undefined);
    assert.equal(findings[0].rule, 'misc');
  });

  it('parses error without rule code', () => {
    const stdout = 'src/app.py:1: error: cannot import\n';
    const findings = mypy.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'type-error');
    assert.equal(findings[0].message, 'cannot import');
  });

  it('skips note: lines', () => {
    const stdout = [
      'src/app.py:42: error: real error  [misc]',
      'src/app.py:43: note: See https://docs/foo',
    ].join('\n');
    assertSingleErrorAtLine(stdout, 42);
  });

  it('throws on mypy error in text mode (exit 2)', () => {
    assert.throws(
      () => mypy.parseOutput('', 'mypy: error: No module named foo', 2),
      /mypy error/
    );
  });

  it('returns empty for clean output', () => {
    assert.deepEqual(mypy.parseOutput('', '', 0), []);
  });
});
