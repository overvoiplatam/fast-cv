import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import trivy from '../../src/tools/trivy.js';

describe('trivy adapter', () => {
  it('has correct metadata', () => {
    assert.equal(trivy.name, 'trivy');
    assert.ok(trivy.extensions.includes('.py'));
    assert.ok(trivy.extensions.includes('.tf'));
    assert.ok(trivy.extensions.includes('.yaml'));
    assert.ok(trivy.installHint.includes('trivy'));
  });

  it('builds correct command without config', () => {
    const { bin, args } = trivy.buildCommand('/tmp/project', null);
    assert.equal(bin, 'trivy');
    assert.ok(args.includes('fs'));
    assert.ok(args.includes('--scanners'));
    assert.ok(args.includes('vuln,misconfig,secret'));
    assert.ok(args.includes('--format'));
    assert.ok(args.includes('json'));
    assert.ok(args.includes('--quiet'));
    assert.ok(args.includes('/tmp/project'));
    assert.ok(!args.includes('--config'));
  });

  it('builds correct command with config', () => {
    const { args } = trivy.buildCommand('/tmp/project', '/etc/trivy.yaml');
    assert.ok(args.includes('--config'));
    assert.ok(args.includes('/etc/trivy.yaml'));
  });

  it('parses vulnerabilities as DEPENDENCY', () => {
    const stdout = JSON.stringify({
      Results: [{
        Target: 'requirements.txt',
        Vulnerabilities: [{
          VulnerabilityID: 'CVE-2023-1234',
          PkgName: 'requests',
          InstalledVersion: '2.28.0',
          FixedVersion: '2.31.0',
          Severity: 'HIGH',
          Title: 'HTTP redirect handling vulnerability',
        }],
      }],
    });

    const findings = trivy.parseOutput(stdout, '', 0);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].tag, 'DEPENDENCY');
    assert.equal(findings[0].rule, 'CVE-2023-1234');
    assert.equal(findings[0].severity, 'error');
    assert.ok(findings[0].message.includes('Vulnerable dependency: requests@2.28.0'));
    assert.ok(findings[0].message.includes('CVE-2023-1234'));
    assert.ok(findings[0].message.includes('(HIGH)'));
    assert.ok(findings[0].message.includes('Upgrade to 2.31.0'));
    assert.equal(findings[0].file, 'requirements.txt');
  });

  it('formats vulnerability with no fix available', () => {
    const stdout = JSON.stringify({
      Results: [{
        Target: 'go.sum',
        Vulnerabilities: [{
          VulnerabilityID: 'CVE-2024-9999',
          PkgName: 'golang.org/x/net',
          InstalledVersion: '0.1.0',
          FixedVersion: '',
          Severity: 'CRITICAL',
          Title: 'Denial of service in HTTP/2',
        }],
      }],
    });

    const findings = trivy.parseOutput(stdout, '', 0);
    assert.equal(findings.length, 1);
    assert.ok(findings[0].message.includes('No fix available'));
    assert.ok(findings[0].message.includes('CVE-2024-9999'));
    assert.ok(findings[0].message.includes('(CRITICAL)'));
  });

  it('parses misconfigurations as INFRA', () => {
    const stdout = JSON.stringify({
      Results: [{
        Target: 'Dockerfile',
        Misconfigurations: [{
          ID: 'DS001',
          Severity: 'MEDIUM',
          Title: 'Running as root user',
          CauseMetadata: { StartLine: 5 },
        }],
      }],
    });

    const findings = trivy.parseOutput(stdout, '', 0);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].tag, 'INFRA');
    assert.equal(findings[0].rule, 'DS001');
    assert.equal(findings[0].severity, 'warning');
    assert.equal(findings[0].line, 5);
    assert.equal(findings[0].file, 'Dockerfile');
  });

  it('parses secrets as SECRET', () => {
    const stdout = JSON.stringify({
      Results: [{
        Target: 'src/config.py',
        Secrets: [{
          RuleID: 'aws-access-key-id',
          Category: 'AWS',
          Title: 'AWS Access Key ID',
          StartLine: 10,
          Match: 'AKIA1234567890EXAMPLE',
        }],
      }],
    });

    const findings = trivy.parseOutput(stdout, '', 0);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].tag, 'SECRET');
    assert.equal(findings[0].rule, 'aws-access-key-id');
    assert.equal(findings[0].severity, 'error');
    assert.equal(findings[0].line, 10);
    assert.ok(findings[0].message.includes('AWS'));
  });

  it('parses mixed results', () => {
    const stdout = JSON.stringify({
      Results: [
        {
          Target: 'requirements.txt',
          Vulnerabilities: [
            { VulnerabilityID: 'CVE-1', PkgName: 'pkg', InstalledVersion: '1.0', Severity: 'LOW', Title: 'Low vuln' },
          ],
        },
        {
          Target: 'Dockerfile',
          Misconfigurations: [
            { ID: 'DS002', Severity: 'CRITICAL', Title: 'Privileged container' },
          ],
          Secrets: [
            { RuleID: 'generic-api-key', Category: 'General', Title: 'API Key', StartLine: 3, Match: 'sk-1234' },
          ],
        },
      ],
    });

    const findings = trivy.parseOutput(stdout, '', 0);
    assert.equal(findings.length, 3);
    assert.equal(findings[0].tag, 'DEPENDENCY');
    assert.equal(findings[0].severity, 'warning'); // LOW severity
    assert.equal(findings[1].tag, 'INFRA');
    assert.equal(findings[1].severity, 'error'); // CRITICAL severity
    assert.equal(findings[2].tag, 'SECRET');
  });

  it('returns empty array for empty output', () => {
    assert.deepEqual(trivy.parseOutput('', '', 0), []);
  });

  it('returns empty array for empty Results', () => {
    const stdout = JSON.stringify({ Results: [] });
    assert.deepEqual(trivy.parseOutput(stdout, '', 0), []);
  });

  it('throws on error with stderr', () => {
    assert.throws(
      () => trivy.parseOutput('', 'fatal error occurred', 1),
      /trivy error/
    );
  });

  it('throws on unparseable JSON', () => {
    assert.throws(
      () => trivy.parseOutput('not json', '', 0),
      /failed to parse JSON/
    );
  });

  it('checkInstalled returns boolean', async () => {
    const result = await trivy.checkInstalled();
    assert.equal(typeof result, 'boolean');
  });
});
