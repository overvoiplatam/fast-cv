import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatReport, filterFindings } from '../src/normalizer.js';
import ignore from 'ignore';

describe('formatReport', () => {
  const targetDir = '/tmp/project';

  function makeOneResult(findingOverrides = {}) {
    return [{
      tool: 'ruff',
      duration: 100,
      findings: [{
        file: 'app.py', line: 1, tag: 'LINTER', rule: 'F401', severity: 'error', message: 'test',
        ...findingOverrides,
      }],
    }];
  }

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
    const results = makeOneResult({ file: '/tmp/project/src/app.py' });
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
    const results = makeOneResult();
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

  it('shows fix mode in header when fix=true', () => {
    const report = formatReport({ targetDir, results: [], warnings: [], fix: true });
    assert.ok(report.includes('**Mode**: fix'));
  });

  it('does not show fix mode when fix=false', () => {
    const report = formatReport({ targetDir, results: [], warnings: [], fix: false });
    assert.ok(!report.includes('**Mode**'));
  });

  it('renders DUPLICATION tag correctly', () => {
    const results = [{
      tool: 'jscpd',
      duration: 200,
      findings: [
        { file: 'src/a.js', line: 10, tag: 'DUPLICATION', rule: 'jscpd/javascript', severity: 'warning', message: 'Duplicated block (20 lines) — also in src/b.js:5' },
      ],
    }];
    const report = formatReport({ targetDir, results, warnings: [] });
    assert.ok(report.includes('**[DUPLICATION]**'));
    assert.ok(report.includes('`jscpd/javascript`'));
  });
});

describe('filterFindings', () => {
  const targetDir = '/tmp/project';

  function makeIgnore(patterns) {
    const ig = ignore();
    ig.add(patterns);
    return ig;
  }

  function runFilter(ig, results, onlyFilter = undefined) {
    return filterFindings(results, targetDir, ig, onlyFilter);
  }

  function makeTwoFindingsResults() {
    return [{
      tool: 'eslint',
      findings: [
        { file: 'src/app.js', line: 1, tag: 'LINTER', rule: 'R1', message: 'keep' },
        { file: 'src/other.js', line: 1, tag: 'LINTER', rule: 'R2', message: 'also keep' },
      ],
    }];
  }

  it('removes findings in ignored paths', () => {
    const ig = makeIgnore(['.svelte-kit/', 'node_modules/']);
    const results = [{
      tool: 'eslint',
      findings: [
        { file: '.svelte-kit/generated/client.js', line: 1, tag: 'LINTER', rule: 'no-eval', message: 'bad' },
        { file: 'src/app.js', line: 5, tag: 'LINTER', rule: 'no-eval', message: 'also bad' },
        { file: 'node_modules/dep/index.js', line: 1, tag: 'LINTER', rule: 'no-eval', message: 'dep bad' },
      ],
    }];

    const filtered = runFilter(ig, results);
    assert.equal(filtered[0].findings.length, 1);
    assert.equal(filtered[0].findings[0].file, 'src/app.js');
  });

  it('handles absolute file paths', () => {
    const ig = makeIgnore(['dist/']);
    const results = [{
      tool: 'eslint',
      findings: [
        { file: '/tmp/project/dist/bundle.js', line: 1, tag: 'LINTER', rule: 'R1', message: 'test' },
        { file: '/tmp/project/src/app.js', line: 1, tag: 'LINTER', rule: 'R1', message: 'test' },
      ],
    }];

    const filtered = runFilter(ig, results);
    assert.equal(filtered[0].findings.length, 1);
    assert.equal(filtered[0].findings[0].file, '/tmp/project/src/app.js');
  });

  it('passes through results with errors unchanged', () => {
    const ig = makeIgnore(['dist/']);
    const results = [{ tool: 'ruff', error: 'timeout', findings: [] }];

    const filtered = runFilter(ig, results);
    assert.equal(filtered[0].error, 'timeout');
    assert.deepEqual(filtered[0].findings, []);
  });

  it('passes through results with no findings', () => {
    const ig = makeIgnore(['dist/']);
    const results = [{ tool: 'ruff', findings: [] }];

    const filtered = runFilter(ig, results);
    assert.deepEqual(filtered[0].findings, []);
  });

  it('passes through results with null findings', () => {
    const ig = makeIgnore(['dist/']);
    const results = [{ tool: 'eslint', error: 'not found', findings: null }];

    const filtered = runFilter(ig, results);
    assert.equal(filtered[0].findings, null);
  });

  it('applies onlyFilter to restrict findings', () => {
    const ig = makeIgnore([]);
    const onlyFilter = {
      includes(relPath) { return relPath === 'src/app.js'; },
    };
    const results = makeTwoFindingsResults();
    const filtered = runFilter(ig, results, onlyFilter);
    assert.equal(filtered[0].findings.length, 1);
    assert.equal(filtered[0].findings[0].file, 'src/app.js');
  });

  it('does not apply onlyFilter when null', () => {
    const ig = makeIgnore([]);
    const results = makeTwoFindingsResults();
    const filtered = runFilter(ig, results, null);
    assert.equal(filtered[0].findings.length, 2);
  });
});
