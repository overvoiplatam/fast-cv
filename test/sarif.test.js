import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatSarif } from '../src/sarif.js';

describe('SARIF formatter', () => {
  const makeResults = (findings, tool = 'ruff') => [{
    tool,
    duration: 1500,
    findings,
  }];

  const makeFinding = (overrides = {}) => ({
    file: '/tmp/project/src/app.py',
    line: 42,
    col: 5,
    tag: 'LINTER',
    rule: 'F401',
    severity: 'warning',
    message: '`os` imported but unused',
    ...overrides,
  });

  it('produces valid SARIF envelope', () => {
    const output = formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([makeFinding()]),
    });

    const sarif = JSON.parse(output);
    assert.equal(sarif.version, '2.1.0');
    assert.ok(sarif.$schema.includes('sarif'));
    assert.equal(sarif.runs.length, 1);
    assert.equal(sarif.runs[0].tool.driver.name, 'fast-cv');
    assert.equal(sarif.runs[0].columnKind, 'utf16CodeUnits');
  });

  it('maps SECURITY tag to error level', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([makeFinding({ tag: 'SECURITY' })]),
    }));
    assert.equal(sarif.runs[0].results[0].level, 'error');
  });

  it('maps BUG tag to error level', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([makeFinding({ tag: 'BUG' })]),
    }));
    assert.equal(sarif.runs[0].results[0].level, 'error');
  });

  it('maps PRIVACY tag to error level', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([makeFinding({ tag: 'PRIVACY' })]),
    }));
    assert.equal(sarif.runs[0].results[0].level, 'error');
  });

  it('maps SECRET tag to error level', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([makeFinding({ tag: 'SECRET' })]),
    }));
    assert.equal(sarif.runs[0].results[0].level, 'error');
  });

  it('maps REFACTOR tag to warning level', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([makeFinding({ tag: 'REFACTOR' })]),
    }));
    assert.equal(sarif.runs[0].results[0].level, 'warning');
  });

  it('maps DEPENDENCY tag to warning level', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([makeFinding({ tag: 'DEPENDENCY' })]),
    }));
    assert.equal(sarif.runs[0].results[0].level, 'warning');
  });

  it('maps INFRA tag to warning level', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([makeFinding({ tag: 'INFRA' })]),
    }));
    assert.equal(sarif.runs[0].results[0].level, 'warning');
  });

  it('maps TYPE_ERROR tag to warning level', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([makeFinding({ tag: 'TYPE_ERROR' })]),
    }));
    assert.equal(sarif.runs[0].results[0].level, 'warning');
  });

  it('maps DOCS tag to warning level', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([makeFinding({ tag: 'DOCS' })]),
    }));
    assert.equal(sarif.runs[0].results[0].level, 'warning');
  });

  it('maps TYPO tag to warning level', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([makeFinding({ tag: 'TYPO' })]),
    }));
    assert.equal(sarif.runs[0].results[0].level, 'warning');
  });

  it('maps FORMAT tag to note level', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([makeFinding({ tag: 'FORMAT' })]),
    }));
    assert.equal(sarif.runs[0].results[0].level, 'note');
  });

  it('maps DUPLICATION tag to note level', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([makeFinding({ tag: 'DUPLICATION' })]),
    }));
    assert.equal(sarif.runs[0].results[0].level, 'note');
  });

  it('deduplicates rules', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([
        makeFinding({ rule: 'F401', file: '/tmp/project/a.py' }),
        makeFinding({ rule: 'F401', file: '/tmp/project/b.py' }),
        makeFinding({ rule: 'E302', file: '/tmp/project/a.py' }),
      ]),
    }));

    assert.equal(sarif.runs[0].tool.driver.rules.length, 2);
    assert.equal(sarif.runs[0].results.length, 3);
    // ruleIndex should match for same rule
    assert.equal(sarif.runs[0].results[0].ruleIndex, sarif.runs[0].results[1].ruleIndex);
    assert.notEqual(sarif.runs[0].results[0].ruleIndex, sarif.runs[0].results[2].ruleIndex);
  });

  it('normalizes paths to relative with forward slashes', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([makeFinding({ file: '/tmp/project/src/app.py' })]),
    }));

    const uri = sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri;
    assert.equal(uri, 'src/app.py');
    assert.equal(
      sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uriBaseId,
      '%SRCROOT%'
    );
  });

  it('includes source tool in result properties', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([makeFinding()], 'eslint'),
    }));

    assert.equal(sarif.runs[0].results[0].properties.sourceTool, 'eslint');
    assert.equal(sarif.runs[0].results[0].properties.tag, 'LINTER');
  });

  it('handles column in region', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([makeFinding({ col: 10 })]),
    }));

    const region = sarif.runs[0].results[0].locations[0].physicalLocation.region;
    assert.equal(region.startLine, 42);
    assert.equal(region.startColumn, 10);
  });

  it('omits startColumn when col is undefined', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([makeFinding({ col: undefined })]),
    }));

    const region = sarif.runs[0].results[0].locations[0].physicalLocation.region;
    assert.equal(region.startLine, 42);
    assert.equal(region.startColumn, undefined);
  });

  it('skips error results', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: [
        { tool: 'ruff', error: 'failed', findings: null, duration: 100 },
        { tool: 'eslint', duration: 200, findings: [makeFinding()] },
      ],
    }));

    assert.equal(sarif.runs[0].results.length, 1);
  });

  it('includes warnings and fix mode in properties', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([makeFinding()]),
      warnings: ['Tool X timed out'],
      fix: true,
    }));

    const props = sarif.runs[0].properties;
    assert.deepEqual(props.warnings, ['Tool X timed out']);
    assert.equal(props.fixMode, true);
    assert.ok(props.targetDir);
    assert.ok(Array.isArray(props.toolBreakdown));
  });

  it('handles empty results', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: [],
    }));

    assert.equal(sarif.runs[0].results.length, 0);
    assert.equal(sarif.runs[0].tool.driver.rules.length, 0);
  });

  it('uses startLine=1 when line is 0', () => {
    const sarif = JSON.parse(formatSarif({
      targetDir: '/tmp/project',
      results: makeResults([makeFinding({ line: 0 })]),
    }));

    assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine, 1);
  });
});
