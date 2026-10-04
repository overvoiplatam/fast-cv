import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import semgrep from '../../src/tools/semgrep.js';

// Shared fixtures — jscpd flags 13+ identical lines, so the big semgrep
// result objects live once and tests compose around them.
const EXEC_FINDING = {
  check_id: 'python.lang.security.audit.exec-detected',
  path: 'src/app.py',
  start: { line: 42, col: 1 },
  extra: {
    message: 'Detected use of exec()',
    severity: 'ERROR',
    metadata: { category: 'security', impact: 'HIGH' },
  },
};

const COMPARISON_FINDING = {
  check_id: 'python.lang.correctness.useless-comparison',
  path: 'src/utils.py',
  start: { line: 10, col: 5 },
  extra: {
    message: 'Useless comparison',
    severity: 'WARNING',
    metadata: { category: 'correctness' },
  },
};

describe('semgrep adapter', () => {
  it('has correct metadata', () => {
    assert.equal(semgrep.name, 'semgrep');
    assert.ok(semgrep.extensions.includes('.py'));
    assert.ok(semgrep.extensions.includes('.js'));
    assert.ok(semgrep.extensions.includes('.go'));
    // expanded language support
    assert.ok(semgrep.extensions.includes('.php'));
    assert.ok(semgrep.extensions.includes('.rs'));
    assert.ok(semgrep.extensions.includes('.c'));
    assert.ok(semgrep.extensions.includes('.cpp'));
    assert.ok(semgrep.extensions.includes('.cs'));
    assert.ok(semgrep.extensions.includes('.kt'));
    assert.ok(semgrep.extensions.includes('.swift'));
    assert.ok(semgrep.extensions.includes('.scala'));
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
    const stdout = JSON.stringify({ results: [EXEC_FINDING, COMPARISON_FINDING] });

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

  it('throws on exit 1 with empty stdout and a stderr message', () => {
    // e.g. `--config auto` failed on a network/config error: exit 1 with no
    // JSON on stdout. Returning [] here would be a false clean.
    assert.throws(
      () => semgrep.parseOutput('', 'network error', 1),
      /semgrep error: network error/
    );
  });

  it('throws on exit 1 with JSON lacking a results block and a stderr message', () => {
    assert.throws(
      () => semgrep.parseOutput(JSON.stringify({ errors: [{ message: 'boom' }] }), 'config failed', 1),
      /semgrep error: config failed/
    );
  });

  it('throws on exit 1 with a null results block and a stderr message', () => {
    // `{"results": null}` must not pass as a scanable block: `|| []` would
    // otherwise turn degraded output into a silent clean scan.
    assert.throws(
      () => semgrep.parseOutput(JSON.stringify({ results: null }), 'degraded run', 1),
      /semgrep error: degraded run/
    );
  });

  it('parses findings on exit 1 with a valid results stdout', () => {
    const stdout = JSON.stringify({
      results: [EXEC_FINDING],
      errors: [{ message: 'partial scan error' }],
    });

    const findings = semgrep.parseOutput(stdout, 'partial scan errors', 1);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'python.lang.security.audit.exec-detected');
  });

  it('returns empty for empty stdout with exit 0', () => {
    const findings = semgrep.parseOutput('', '', 0);
    assert.equal(findings.length, 0);
  });
});
