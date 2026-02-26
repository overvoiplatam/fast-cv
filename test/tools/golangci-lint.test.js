import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import golangciLint from '../../src/tools/golangci-lint.js';

describe('golangci-lint adapter', () => {
  it('has correct metadata', () => {
    assert.equal(golangciLint.name, 'golangci-lint');
    assert.deepEqual(golangciLint.extensions, ['.go']);
  });

  it('builds command without config (enables gocognit)', () => {
    const { bin, args } = golangciLint.buildCommand('/tmp/project', null);
    assert.equal(bin, 'golangci-lint');
    assert.ok(args.includes('run'));
    assert.ok(args.includes('--out-format'));
    assert.ok(args.includes('json'));
    assert.ok(!args.includes('--config'));
    assert.ok(args.includes('--enable'));
    assert.ok(args.includes('gocognit'));
  });

  it('builds command with config (skips --enable)', () => {
    const { args } = golangciLint.buildCommand('/tmp/project', '/etc/golangci.yml');
    assert.ok(args.includes('--config'));
    assert.ok(args.includes('/etc/golangci.yml'));
    assert.ok(!args.includes('--enable'));
  });

  it('builds command with --fix flag', () => {
    const { args } = golangciLint.buildCommand('/tmp/project', null, { fix: true });
    assert.ok(args.includes('--fix'));
  });

  it('uses file paths instead of ./... when files provided', () => {
    const { args } = golangciLint.buildCommand('/tmp/project', null, { files: ['main.go', 'pkg/util.go'] });
    assert.ok(args.includes('main.go'));
    assert.ok(args.includes('pkg/util.go'));
    assert.ok(!args.includes('./...'));
  });

  it('parses JSON output with issues', () => {
    const stdout = JSON.stringify({
      Issues: [
        {
          FromLinter: 'govet',
          Text: 'printf: non-constant format string',
          Severity: 'warning',
          Pos: { Filename: 'main.go', Line: 42, Column: 10 },
        },
        {
          FromLinter: 'errcheck',
          Text: 'Error return value not checked',
          Severity: 'error',
          Pos: { Filename: 'handler.go', Line: 15 },
        },
      ],
    });

    const findings = golangciLint.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 2);
    assert.equal(findings[0].tag, 'BUG');
    assert.equal(findings[0].rule, 'govet');
    assert.equal(findings[0].line, 42);
    assert.equal(findings[0].col, 10);
    assert.equal(findings[1].rule, 'errcheck');
    assert.equal(findings[1].tag, 'BUG');
    assert.equal(findings[1].severity, 'error');
  });

  it('classifies linter tags correctly', () => {
    const make = (linter) => JSON.stringify({
      Issues: [{ FromLinter: linter, Text: 'test', Severity: 'warning', Pos: { Filename: 'f.go', Line: 1 } }],
    });
    assert.equal(golangciLint.parseOutput(make('gocognit'), '', 1)[0].tag, 'REFACTOR');
    assert.equal(golangciLint.parseOutput(make('cyclop'), '', 1)[0].tag, 'REFACTOR');
    assert.equal(golangciLint.parseOutput(make('nestif'), '', 1)[0].tag, 'REFACTOR');
    assert.equal(golangciLint.parseOutput(make('govet'), '', 1)[0].tag, 'BUG');
    assert.equal(golangciLint.parseOutput(make('staticcheck'), '', 1)[0].tag, 'BUG');
    assert.equal(golangciLint.parseOutput(make('errcheck'), '', 1)[0].tag, 'BUG');
    assert.equal(golangciLint.parseOutput(make('gosec'), '', 1)[0].tag, 'SECURITY');
    assert.equal(golangciLint.parseOutput(make('revive'), '', 1)[0].tag, 'DOCS');
    assert.equal(golangciLint.parseOutput(make('gocritic'), '', 1)[0].tag, 'LINTER');
  });

  it('returns empty for clean output', () => {
    const stdout = JSON.stringify({ Issues: [] });
    const findings = golangciLint.parseOutput(stdout, '', 0);
    assert.equal(findings.length, 0);
  });

  it('returns empty for empty stdout with exit 0', () => {
    const findings = golangciLint.parseOutput('', '', 0);
    assert.equal(findings.length, 0);
  });

  it('throws on error exit with no stdout', () => {
    assert.throws(
      () => golangciLint.parseOutput('', 'error loading', 3),
      /golangci-lint error/
    );
  });
});
