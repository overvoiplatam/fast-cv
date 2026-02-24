import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import stylelint from '../../src/tools/stylelint.js';

describe('stylelint adapter', () => {
  it('has correct metadata', () => {
    assert.equal(stylelint.name, 'stylelint');
    assert.ok(stylelint.extensions.includes('.css'));
    assert.ok(stylelint.extensions.includes('.scss'));
    assert.ok(stylelint.extensions.includes('.sass'));
    assert.ok(stylelint.extensions.includes('.less'));
    assert.ok(stylelint.installHint.includes('stylelint'));
  });

  it('builds command with --formatter json and --allow-empty-input', () => {
    const { bin, args } = stylelint.buildCommand('/tmp/project', null);
    assert.equal(bin, 'stylelint');
    assert.ok(args.includes('--formatter'));
    assert.ok(args.includes('json'));
    assert.ok(args.includes('--allow-empty-input'));
    assert.ok(args.some(a => a.includes('**/*.{css,scss,sass,less}')));
  });

  it('builds command with config', () => {
    const { args } = stylelint.buildCommand('/tmp/project', '/etc/.stylelintrc.json');
    assert.ok(args.includes('--config'));
    assert.ok(args.includes('/etc/.stylelintrc.json'));
  });

  it('builds command with --fix flag', () => {
    const { args } = stylelint.buildCommand('/tmp/project', null, { fix: true });
    assert.ok(args.includes('--fix'));
  });

  it('builds command with files list', () => {
    const { args } = stylelint.buildCommand('/tmp/project', null, { files: ['src/a.css', 'src/b.scss'] });
    assert.ok(args.includes('src/a.css'));
    assert.ok(args.includes('src/b.scss'));
    assert.ok(!args.some(a => a.includes('**/*')));
  });

  it('parses JSON output with findings', () => {
    const stdout = JSON.stringify([
      {
        source: '/tmp/project/src/app.css',
        warnings: [
          { line: 5, column: 3, rule: 'indentation', severity: 'warning', text: 'Expected indentation of 2 spaces' },
          { line: 10, column: 1, rule: 'color-no-invalid-hex', severity: 'error', text: 'Unexpected invalid hex color' },
        ],
      },
      {
        source: '/tmp/project/src/clean.css',
        warnings: [],
      },
    ]);

    const findings = stylelint.parseOutput(stdout, '', 2);
    assert.equal(findings.length, 2);
    assert.equal(findings[0].file, '/tmp/project/src/app.css');
    assert.equal(findings[0].line, 5);
    assert.equal(findings[0].col, 3);
    assert.equal(findings[0].rule, 'indentation');
    assert.equal(findings[0].tag, 'FORMAT');
    assert.equal(findings[0].severity, 'warning');

    assert.equal(findings[1].rule, 'color-no-invalid-hex');
    assert.equal(findings[1].tag, 'LINTER');
    assert.equal(findings[1].severity, 'error');
  });

  it('classifies FORMAT vs LINTER tags', () => {
    const make = (rule) => JSON.stringify([{
      source: 'f.css',
      warnings: [{ line: 1, column: 1, rule, severity: 'warning', text: 'test' }],
    }]);

    assert.equal(stylelint.parseOutput(make('indentation'), '', 2)[0].tag, 'FORMAT');
    assert.equal(stylelint.parseOutput(make('no-eol-whitespace'), '', 2)[0].tag, 'FORMAT');
    assert.equal(stylelint.parseOutput(make('no-missing-end-of-source-newline'), '', 2)[0].tag, 'FORMAT');
    assert.equal(stylelint.parseOutput(make('no-extra-semicolons'), '', 2)[0].tag, 'FORMAT');
    assert.equal(stylelint.parseOutput(make('color-no-invalid-hex'), '', 2)[0].tag, 'LINTER');
    assert.equal(stylelint.parseOutput(make('declaration-block-no-duplicate-properties'), '', 2)[0].tag, 'LINTER');
  });

  it('returns empty for clean output', () => {
    const stdout = JSON.stringify([{ source: 'f.css', warnings: [] }]);
    const findings = stylelint.parseOutput(stdout, '', 0);
    assert.equal(findings.length, 0);
  });

  it('throws on fatal error exit codes', () => {
    assert.throws(
      () => stylelint.parseOutput('', 'Fatal error', 78),
      /stylelint error/
    );
    assert.throws(
      () => stylelint.parseOutput('', 'Fatal error', 1),
      /stylelint error/
    );
    assert.throws(
      () => stylelint.parseOutput('', 'Bad CLI', 64),
      /stylelint error/
    );
  });

  it('checkInstalled returns boolean', async () => {
    const result = await stylelint.checkInstalled();
    assert.equal(typeof result, 'boolean');
  });
});
