import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatReport } from '../src/normalizer.js';

describe('formatReport', () => {
  const targetDir = '/tmp/project';

  it('produces clean report when no findings', () => {
    const report = formatReport({ targetDir, results: [], warnings: [] });
    assert.ok(report.includes('# fast-cv report'));
    assert.ok(report.includes('## No issues found'));
    assert.ok(report.includes('All checks passed.'));
    assert.ok(report.includes(`**Target**: \`${targetDir}\``));
  });

  it('formats findings grouped by file', () => {
    const results = [{
      tool: 'ruff',
      duration: 400,
      findings: [
        { file: 'src/app.py', line: 1, tag: 'LINTER', rule: 'F401', severity: 'error', message: '`os` imported but unused' },
        { file: 'src/app.py', line: 15, tag: 'FORMAT', rule: 'E302', severity: 'warning', message: 'Expected 2 blank lines, found 1' },
        { file: 'src/auth.py', line: 42, col: 5, tag: 'SECURITY', rule: 'S105', severity: 'error', message: 'Hardcoded password detected' },
      ],
    }];

    const report = formatReport({ targetDir, results, warnings: [] });

    assert.ok(report.includes('## Findings (3 issues)'));
    assert.ok(report.includes('### `src/app.py`'));
    assert.ok(report.includes('### `src/auth.py`'));
    assert.ok(report.includes('**[LINTER]** `F401` `os` imported but unused (line 1)'));
    assert.ok(report.includes('**[SECURITY]** `S105` Hardcoded password detected (line 42, col 5)'));
    assert.ok(report.includes('**Tools**: ruff (0.4s)'));
  });

  it('includes warnings section', () => {
    const report = formatReport({
      targetDir,
      results: [],
      warnings: ['bearer: not found in PATH, skipping'],
    });

    assert.ok(report.includes('## Warnings'));
    assert.ok(report.includes('**[WARN]** bearer: not found in PATH, skipping'));
  });

  it('sorts files alphabetically', () => {
    const results = [{
      tool: 'ruff',
      duration: 100,
      findings: [
        { file: 'z.py', line: 1, tag: 'LINTER', rule: 'F401', severity: 'error', message: 'test' },
        { file: 'a.py', line: 1, tag: 'LINTER', rule: 'F401', severity: 'error', message: 'test' },
      ],
    }];

    const report = formatReport({ targetDir, results, warnings: [] });
    const aPos = report.indexOf('### `a.py`');
    const zPos = report.indexOf('### `z.py`');
    assert.ok(aPos < zPos, 'Files should be sorted alphabetically');
  });

  it('sorts findings within a file by line number', () => {
    const results = [{
      tool: 'ruff',
      duration: 100,
      findings: [
        { file: 'app.py', line: 20, tag: 'LINTER', rule: 'F401', severity: 'error', message: 'late' },
        { file: 'app.py', line: 5, tag: 'FORMAT', rule: 'E302', severity: 'warning', message: 'early' },
      ],
    }];

    const report = formatReport({ targetDir, results, warnings: [] });
    const earlyPos = report.indexOf('early');
    const latePos = report.indexOf('late');
    assert.ok(earlyPos < latePos, 'Findings should be sorted by line number');
  });

  it('handles absolute file paths by making them relative', () => {
    const results = [{
      tool: 'ruff',
      duration: 100,
      findings: [
        { file: '/tmp/project/src/app.py', line: 1, tag: 'LINTER', rule: 'F401', severity: 'error', message: 'test' },
      ],
    }];

    const report = formatReport({ targetDir, results, warnings: [] });
    assert.ok(report.includes('### `src/app.py`'));
    assert.ok(!report.includes('### `/tmp/project'));
  });

  it('combines findings from multiple tools', () => {
    const results = [
      {
        tool: 'ruff',
        duration: 400,
        findings: [
          { file: 'app.py', line: 1, tag: 'LINTER', rule: 'F401', severity: 'error', message: 'unused import' },
        ],
      },
      {
        tool: 'eslint',
        duration: 1100,
        findings: [
          { file: 'app.js', line: 88, col: 5, tag: 'LINTER', rule: 'no-eval', severity: 'error', message: 'Unexpected use of eval()' },
        ],
      },
    ];

    const report = formatReport({ targetDir, results, warnings: [] });
    assert.ok(report.includes('## Findings (2 issues)'));
    assert.ok(report.includes('**Tools**: ruff (0.4s), eslint (1.1s)'));
    assert.ok(report.includes('### `app.py`'));
    assert.ok(report.includes('### `app.js`'));
  });

  it('handles singular forms correctly', () => {
    const results = [{
      tool: 'ruff',
      duration: 100,
      findings: [
        { file: 'app.py', line: 1, tag: 'LINTER', rule: 'F401', severity: 'error', message: 'test' },
      ],
    }];

    const report = formatReport({ targetDir, results, warnings: [] });
    assert.ok(report.includes('## Findings (1 issue)'));
    assert.ok(report.includes('*1 finding from 1 tool'));
  });

  it('skips results with errors in tool summaries', () => {
    const results = [
      { tool: 'ruff', duration: 400, findings: [] },
      { tool: 'eslint', error: 'command not found', findings: null },
    ];

    const report = formatReport({ targetDir, results, warnings: [] });
    assert.ok(report.includes('ruff'));
    assert.ok(!report.includes('**Tools**: ruff (0.4s), eslint'));
  });
});
