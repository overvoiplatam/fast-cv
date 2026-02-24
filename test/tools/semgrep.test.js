import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import semgrep from '../../src/tools/semgrep.js';

describe('semgrep adapter', () => {
  it('has correct metadata', () => {
    assert.equal(semgrep.name, 'semgrep');
    assert.ok(semgrep.extensions.includes('.py'));
    assert.ok(semgrep.extensions.includes('.js'));
    assert.ok(semgrep.extensions.includes('.go'));
  });

  it('builds command with auto config when no config provided', () => {
    const { bin, args } = semgrep.buildCommand('/tmp/project', null);
    assert.equal(bin, 'semgrep');
    assert.ok(args.includes('scan'));
    assert.ok(args.includes('--json'));
    assert.ok(args.includes('--config'));
    assert.ok(args.includes('auto'));
  });

  it('builds command with custom config', () => {
    const { args } = semgrep.buildCommand('/tmp/project', '/etc/semgrep.yml');
    assert.ok(args.includes('--config'));
    assert.ok(args.includes('/etc/semgrep.yml'));
    assert.ok(!args.includes('auto'));
  });

  it('parses JSON output with results', () => {
    const stdout = JSON.stringify({
      results: [
        {
          check_id: 'python.lang.security.audit.exec-detected',
          path: 'src/app.py',
          start: { line: 42, col: 1 },
          extra: {
            message: 'Detected use of exec()',
            severity: 'ERROR',
            metadata: { category: 'security', impact: 'HIGH' },
          },
        },
        {
          check_id: 'python.lang.correctness.useless-comparison',
          path: 'src/utils.py',
          start: { line: 10, col: 5 },
          extra: {
            message: 'Useless comparison',
            severity: 'WARNING',
            metadata: { category: 'correctness' },
          },
        },
      ],
    });

    const findings = semgrep.parseOutput(stdout, '', 0);
    assert.equal(findings.length, 2);
    assert.equal(findings[0].tag, 'SECURITY');
    assert.equal(findings[0].rule, 'python.lang.security.audit.exec-detected');
    assert.equal(findings[0].line, 42);
    assert.equal(findings[1].tag, 'BUG');
  });

  it('returns empty for clean output', () => {
    const stdout = JSON.stringify({ results: [] });
    const findings = semgrep.parseOutput(stdout, '', 0);
    assert.equal(findings.length, 0);
  });

  it('throws on fatal error with no output', () => {
    assert.throws(
      () => semgrep.parseOutput('', 'Fatal error', 2),
      /semgrep error/
    );
  });

  it('returns empty for empty stdout with exit 0', () => {
    const findings = semgrep.parseOutput('', '', 0);
    assert.equal(findings.length, 0);
  });
});
