import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bearer from '../../src/tools/bearer.js';

describe('bearer adapter', () => {
  it('has correct metadata', () => {
    assert.equal(bearer.name, 'bearer');
    assert.ok(bearer.extensions.includes('.py'));
    assert.ok(bearer.extensions.includes('.js'));
    assert.ok(bearer.extensions.includes('.php'));
  });

  it('builds command without config', () => {
    const { bin, args } = bearer.buildCommand('/tmp/project', null);
    assert.equal(bin, 'bearer');
    assert.ok(args.includes('scan'));
    assert.ok(args.includes('--format'));
    assert.ok(args.includes('json'));
    assert.ok(args.includes('/tmp/project'));
  });

  it('builds command with config', () => {
    const { args } = bearer.buildCommand('/tmp/project', '/etc/bearer.yml');
    assert.ok(args.includes('--config-file'));
    assert.ok(args.includes('/etc/bearer.yml'));
  });

  it('parses JSON output with findings', () => {
    const stdout = JSON.stringify({
      warnings: [
        {
          rule_id: 'python_lang_logger',
          title: 'Sensitive data sent to logger',
          severity: 'high',
          filename: 'src/app.py',
          locations: [
            { filename: 'src/app.py', line_number: 15 },
          ],
        },
      ],
    });

    const findings = bearer.parseOutput(stdout, '', 1);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].tag, 'PRIVACY');
    assert.equal(findings[0].rule, 'python_lang_logger');
    assert.equal(findings[0].file, 'src/app.py');
    assert.equal(findings[0].line, 15);
    assert.equal(findings[0].severity, 'error');
  });

  it('returns empty for clean output', () => {
    const stdout = JSON.stringify({ warnings: [] });
    const findings = bearer.parseOutput(stdout, '', 0);
    assert.equal(findings.length, 0);
  });

  it('returns empty for empty stdout with exit 0', () => {
    const findings = bearer.parseOutput('', '', 0);
    assert.equal(findings.length, 0);
  });

  it('throws on fatal error', () => {
    assert.throws(
      () => bearer.parseOutput('', 'fatal', 2),
      /bearer error/
    );
  });

  it('handles critical severity', () => {
    const stdout = JSON.stringify({
      warnings: [{
        rule_id: 'test',
        severity: 'critical',
        title: 'Critical issue',
        filename: 'f.py',
        locations: [{ filename: 'f.py', line_number: 1 }],
      }],
    });
    const findings = bearer.parseOutput(stdout, '', 1);
    assert.equal(findings[0].severity, 'error');
  });

  it('handles low severity', () => {
    const stdout = JSON.stringify({
      warnings: [{
        rule_id: 'test',
        severity: 'low',
        title: 'Minor issue',
        filename: 'f.py',
        locations: [{ filename: 'f.py', line_number: 1 }],
      }],
    });
    const findings = bearer.parseOutput(stdout, '', 1);
    assert.equal(findings[0].severity, 'warning');
  });
});
