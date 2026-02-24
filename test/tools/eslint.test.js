import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import eslint from '../../src/tools/eslint.js';
import { testBuildCommandNoConfig } from '../helpers.js';

describe('eslint adapter', () => {
  it('has correct metadata', () => {
    assert.equal(eslint.name, 'eslint');
    assert.ok(eslint.extensions.includes('.js'));
    assert.ok(eslint.extensions.includes('.ts'));
    assert.ok(eslint.installHint.includes('eslint'));
  });

  it('builds command without config', () => {
    testBuildCommandNoConfig(eslint, 'eslint');
  });

  it('builds command with config', () => {
    const { args } = eslint.buildCommand('/tmp/project', '/etc/eslint.json');
    assert.ok(args.includes('--config'));
    assert.ok(args.includes('/etc/eslint.json'));
  });

  it('builds command with --fix flag', () => {
    const { args } = eslint.buildCommand('/tmp/project', null, { fix: true });
    assert.ok(args.includes('--fix'));
  });

  it('builds command with files list', () => {
    const { args } = eslint.buildCommand('/tmp/project', null, { files: ['src/a.js', 'src/b.ts'] });
    assert.ok(args.includes('src/a.js'));
    assert.ok(args.includes('src/b.ts'));
    assert.ok(!args.includes('/tmp/project'));
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
    assert.equal(findings[0].tag, 'SECURITY');
    assert.equal(findings[0].line, 10);
    assert.equal(findings[0].col, 5);
    assert.equal(findings[1].severity, 'warning');
    assert.equal(findings[1].tag, 'BUG');
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

  it('classifies rule tags correctly', () => {
    const make = (ruleId) => JSON.stringify([{
      filePath: 'f.js',
      messages: [{ ruleId, severity: 2, message: 'test', line: 1, column: 1 }],
    }]);

    // Security rules
    assert.equal(eslint.parseOutput(make('no-eval'), '', 1)[0].tag, 'SECURITY');
    assert.equal(eslint.parseOutput(make('no-implied-eval'), '', 1)[0].tag, 'SECURITY');
    assert.equal(eslint.parseOutput(make('no-new-func'), '', 1)[0].tag, 'SECURITY');
    assert.equal(eslint.parseOutput(make('security/detect-eval-with-expression'), '', 1)[0].tag, 'SECURITY');

    // Refactor rules
    assert.equal(eslint.parseOutput(make('complexity'), '', 1)[0].tag, 'REFACTOR');
    assert.equal(eslint.parseOutput(make('max-depth'), '', 1)[0].tag, 'REFACTOR');
    assert.equal(eslint.parseOutput(make('max-lines-per-function'), '', 1)[0].tag, 'REFACTOR');
    assert.equal(eslint.parseOutput(make('max-nested-callbacks'), '', 1)[0].tag, 'REFACTOR');

    // Bug rules
    assert.equal(eslint.parseOutput(make('no-unreachable'), '', 1)[0].tag, 'BUG');
    assert.equal(eslint.parseOutput(make('no-unused-vars'), '', 1)[0].tag, 'BUG');
    assert.equal(eslint.parseOutput(make('no-constant-condition'), '', 1)[0].tag, 'BUG');

    // sonarjs bug rules
    assert.equal(eslint.parseOutput(make('sonarjs/no-all-duplicated-branches'), '', 1)[0].tag, 'BUG');
    assert.equal(eslint.parseOutput(make('sonarjs/no-identical-conditions'), '', 1)[0].tag, 'BUG');
    assert.equal(eslint.parseOutput(make('sonarjs/no-identical-expressions'), '', 1)[0].tag, 'BUG');

    // sonarjs refactor rules
    assert.equal(eslint.parseOutput(make('sonarjs/cognitive-complexity'), '', 1)[0].tag, 'REFACTOR');
    assert.equal(eslint.parseOutput(make('sonarjs/no-duplicate-string'), '', 1)[0].tag, 'REFACTOR');
    assert.equal(eslint.parseOutput(make('sonarjs/no-identical-functions'), '', 1)[0].tag, 'REFACTOR');
    assert.equal(eslint.parseOutput(make('sonarjs/prefer-immediate-return'), '', 1)[0].tag, 'REFACTOR');

    // sonarjs fallback → REFACTOR
    assert.equal(eslint.parseOutput(make('sonarjs/some-new-rule'), '', 1)[0].tag, 'REFACTOR');

    // Unknown → LINTER
    assert.equal(eslint.parseOutput(make('semi'), '', 1)[0].tag, 'LINTER');
    assert.equal(eslint.parseOutput(make('eqeqeq'), '', 1)[0].tag, 'LINTER');
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
