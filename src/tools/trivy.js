import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export default {
  name: 'trivy',
  extensions: ['.py', '.js', '.ts', '.go', '.java', '.rb', '.php', '.tf', '.yaml', '.yml'],
  installHint: 'curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b ~/.local/bin',

  buildCommand(targetDir, configPath) {
    const args = ['fs', '--scanners', 'vuln,misconfig,secret', '--format', 'json', '--quiet'];
    if (configPath) args.push('--config', configPath);
    // trivy scans the full directory (ignores files arg — same pattern as jscpd)
    args.push(targetDir);
    return { bin: 'trivy', args };
  },

  parseOutput(stdout, stderr, exitCode) {
    if (!stdout.trim()) {
      if (exitCode > 0 && stderr.trim()) {
        throw new Error(`trivy error: ${stderr.slice(0, 500)}`);
      }
      return [];
    }

    let data;
    try {
      data = JSON.parse(stdout);
    } catch {
      throw new Error(`trivy: failed to parse JSON output: ${stdout.slice(0, 200)}`);
    }

    const results = data.Results || [];
    const findings = [];

    for (const entry of results) {
      const target = entry.Target || 'unknown';

      // Vulnerabilities → DEPENDENCY
      for (const vuln of entry.Vulnerabilities || []) {
        findings.push({
          file: target,
          line: 0,
          col: undefined,
          tag: 'DEPENDENCY',
          rule: vuln.VulnerabilityID || 'unknown-cve',
          severity: ['CRITICAL', 'HIGH'].includes(vuln.Severity) ? 'error' : 'warning',
          message: `Vulnerable dependency: ${vuln.PkgName}@${vuln.InstalledVersion} has ${vuln.VulnerabilityID} (${vuln.Severity}). ${vuln.FixedVersion ? `Upgrade to ${vuln.FixedVersion}` : 'No fix available'}. ${vuln.Title}`,
        });
      }

      // Misconfigurations → INFRA
      for (const misconf of entry.Misconfigurations || []) {
        findings.push({
          file: target,
          line: misconf.CauseMetadata?.StartLine || 0,
          col: undefined,
          tag: 'INFRA',
          rule: misconf.ID || 'unknown-misconfig',
          severity: ['CRITICAL', 'HIGH'].includes(misconf.Severity) ? 'error' : 'warning',
          message: misconf.Title || misconf.Message,
        });
      }

      // Secrets → SECRET
      for (const secret of entry.Secrets || []) {
        findings.push({
          file: target,
          line: secret.StartLine || 0,
          col: undefined,
          tag: 'SECRET',
          rule: secret.RuleID || 'secret',
          severity: 'error',
          message: `${secret.Category}: ${secret.Title} (match: ${secret.Match?.slice(0, 30)}...)`,
        });
      }
    }

    return findings;
  },

  async checkInstalled() {
    try {
      await execFileAsync('trivy', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
