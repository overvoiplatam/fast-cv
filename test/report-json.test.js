import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatJsonReport } from '../src/report-json.js';

describe('formatJsonReport', () => {
  const targetDir = '/tmp/project';

  function makeResults() {
    return [
      {
        tool: 'ruff',
        duration: 12,
        findings: [
          { file: 'app.py', line: 3, col: 5, tag: 'LINTER', rule: 'F401', severity: 'error', message: 'unused import' },
          { file: 'app.py', line: 9, tag: 'DOCS', rule: 'D100', severity: 'warning', message: 'missing docstring' },
        ],
      },
      {
        tool: 'knip',
        duration: 40,
        error: 'Timeout after 5s',
        hint: 'Raise the budget with `--timeout 300`.',
        findings: [],
      },
    ];
  }

  it('emits a stable, minimal shape (snapshot)', () => {
    const out = formatJsonReport({
      targetDir,
      results: makeResults(),
      warnings: ['No applicable tools for detected languages.'],
      fileCount: 2,
    });

    assert.deepEqual(JSON.parse(out), {
      target: '/tmp/project',
      summary: {
        files: 2,
        tools: [
          { name: 'ruff', findings: 2, error: false },
          { name: 'knip', findings: 0, error: true },
        ],
        findings: 2,
        errors: 1,
      },
      findings: [
        { tool: 'ruff', file: 'app.py', line: 3, col: 5, tag: 'LINTER', rule: 'F401', severity: 'error', message: 'unused import' },
        { tool: 'ruff', file: 'app.py', line: 9, tag: 'DOCS', rule: 'D100', severity: 'warning', message: 'missing docstring' },
      ],
      toolErrors: [
        { tool: 'knip', error: 'Timeout after 5s', hint: 'Raise the budget with `--timeout 300`.' },
      ],
      warnings: ['No applicable tools for detected languages.'],
    });
  });

  it('omits col when the tool did not report one', () => {
    const out = formatJsonReport({ targetDir, results: makeResults(), fileCount: 2 });
    const parsed = JSON.parse(out);
    assert.ok('col' in parsed.findings[0]);
    assert.ok(!('col' in parsed.findings[1]));
  });

  it('omits hint when the tool error carries none', () => {
    const out = formatJsonReport({
      targetDir,
      results: [{ tool: 'trivy', error: 'db update failed', findings: [] }],
      fileCount: 0,
    });
    const parsed = JSON.parse(out);
    assert.deepEqual(parsed.toolErrors, [{ tool: 'trivy', error: 'db update failed' }]);
    assert.equal(parsed.summary.tools[0].error, true);
  });

  it('makes absolute finding paths relative to the target', () => {
    const out = formatJsonReport({
      targetDir,
      results: [{
        tool: 'ruff',
        findings: [{ file: '/tmp/project/src/app.py', line: 1, col: 1, tag: 'LINTER', rule: 'F401', severity: 'error', message: 'x' }],
      }],
      fileCount: 1,
    });
    const parsed = JSON.parse(out);
    assert.equal(parsed.findings[0].file, 'src/app.py');
    assert.equal(parsed.findings[0].tool, 'ruff');
  });

  it('reports minSeverity in the summary only when the filter is active', () => {
    const active = JSON.parse(formatJsonReport({
      targetDir, results: makeResults(), fileCount: 2, minSeverity: 'error',
    }));
    assert.equal(active.summary.minSeverity, 'error');

    const quiet = JSON.parse(formatJsonReport({
      targetDir, results: makeResults(), fileCount: 2, minSeverity: 'warning',
    }));
    assert.ok(!('minSeverity' in quiet.summary));
  });

  it('counts only completed tools in summary.findings and keeps errors separate', () => {
    const parsed = JSON.parse(formatJsonReport({
      targetDir,
      results: [
        { tool: 'ruff', findings: [{ file: 'a.py', line: 1, tag: 'LINTER', rule: 'F401', severity: 'error', message: 'x' }] },
        { tool: 'knip', error: 'parse failed', findings: [{ file: 'b.py', line: 1, tag: 'LINTER', rule: 'x', severity: 'error', message: 'y' }] },
      ],
      fileCount: 5,
    }));
    assert.equal(parsed.summary.findings, 1);
    assert.equal(parsed.summary.errors, 1);
    assert.equal(parsed.findings.length, 1);
    assert.deepEqual(parsed.summary.tools, [
      { name: 'ruff', findings: 1, error: false },
      { name: 'knip', findings: 0, error: true },
    ]);
    // Invariant: per-tool counts add up to the report total.
    assert.equal(
      parsed.summary.tools.reduce((sum, t) => sum + t.findings, 0),
      parsed.summary.findings,
    );
  });

  it('is pretty-printed and terminated by a newline', () => {
    const out = formatJsonReport({ targetDir, results: [], fileCount: 0, warnings: [] });
    assert.ok(out.endsWith('\n'));
    assert.ok(out.includes('\n  "summary"'));
    assert.deepEqual(JSON.parse(out), {
      target: '/tmp/project',
      summary: { files: 0, tools: [], findings: 0, errors: 0 },
      findings: [],
      toolErrors: [],
      warnings: [],
    });
  });
});
