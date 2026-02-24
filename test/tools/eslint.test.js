import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import eslint from '../../src/tools/eslint.js';

describe('eslint adapter', () => {
  it('has correct metadata', () => {
    assert.equal(eslint.name, 'eslint');
    assert.ok(eslint.extensions.includes('.js'));
    assert.ok(eslint.extensions.includes('.ts'));
    assert.ok(eslint.installHint.includes('eslint'));
  });

  it('builds command without config', () => {
    const { bin, args } = eslint.buildCommand('/tmp/project', null);
    assert.equal(bin, 'eslint');
    assert.ok(args.includes('--format'));
    assert.ok(args.includes('json'));
    assert.ok(args.includes('/tmp/project'));
    assert.ok(!args.includes('--config'));
  });

  it('builds command with config', () => {
    const { args } = eslint.buildCommand('/tmp/project', '/etc/eslint.json');
    assert.ok(args.includes('--config'));
    assert.ok(args.includes('/etc/eslint.json'));
  });

  it('parses JSON output with findings', () => {
    const stdout = JSON.stringify([
      {
        filePath: '/tmp/project/src/app.js',
        messages: [
          { ruleId: 'no-eval', severity: 2, message: 'eval can be harmful', line: 10, column: 5 },
          { ruleId: 'no-unused-vars', severity: 1, message: "'x' is defined but never used", line: 3, column: 7 },
        ],
        errorCount: 1,
        warningCount: 1,
      },
      {
        filePath: '/tmp/project/src/clean.js',
        messages: [],
        errorCount: 0,
        warningCount: 0,
      },
    ]);

    const findings = eslint.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 2);
    assert.equal(findings[0].rule, 'no-eval');
    assert.equal(findings[0].severity, 'error');
    assert.equal(findings[0].tag, 'LINTER');
    assert.equal(findings[0].line, 10);
    assert.equal(findings[0].col, 5);
    assert.equal(findings[1].severity, 'warning');
  });

  it('returns empty for clean output', () => {
    const stdout = JSON.stringify([{ filePath: 'f.js', messages: [] }]);
    const findings = eslint.parseOutput(stdout, '', 0);
    assert.equal(findings.length, 0);
  });

  it('throws on fatal error', () => {
    assert.throws(
      () => eslint.parseOutput('', 'Oops!', 2),
      /eslint error/
    );
  });

  it('handles parse error messages (no ruleId)', () => {
    const stdout = JSON.stringify([{
      filePath: 'bad.js',
      messages: [{ severity: 2, message: 'Parsing error: unexpected token', line: 1, column: 1 }],
    }]);
    const findings = eslint.parseOutput(stdout, '', 1);
    assert.equal(findings[0].rule, 'parse-error');
  });
});
