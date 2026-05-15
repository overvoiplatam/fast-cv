import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function formatTrivyError(stderr) {
  const message = stderr.slice(0, 500);
  const shouldAdviseUpdate = /db|database|metadata|cache|download|update/i.test(stderr);
  if (!shouldAdviseUpdate) return `trivy error: ${message}`;
  return `trivy error: ${message} Run fast-cv with --update-db to refresh the trivy databases before scanning, or rerun install.sh --mode all to warm the cache.`;
}

function formatTrivyVulnMessage(vuln) {
  const fixGuidance = vuln.FixedVersion ? `Upgrade to ${vuln.FixedVersion}` : 'No fix available';
  return `Vulnerable dependency: ${vuln.PkgName}@${vuln.InstalledVersion} has ${vuln.VulnerabilityID} (${vuln.Severity}). ${fixGuidance}. ${vuln.Title}`;
}

const HIGH_OR_CRITICAL = new Set(['CRITICAL', 'HIGH']);

function parseTrivyJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`trivy: failed to parse JSON output: ${stdout.slice(0, 200)}`);
  }
}

function toEntryFindings(entry) {
  const target = entry.Target || 'unknown';
  return [
    ...(entry.Vulnerabilities || []).map(v => vulnFinding(target, v)),
    ...(entry.Misconfigurations || []).map(m => misconfigFinding(target, m)),
    ...(entry.Secrets || []).map(s => secretFinding(target, s)),
    ...(entry.Licenses || []).filter(l => HIGH_OR_CRITICAL.has(l.Severity)).map(l => licenseFinding(target, l)),
  ];
}

function vulnFinding(target, vuln) {
  return {
    file: target,
    line: 0,
    col: undefined,
    tag: 'DEPENDENCY',
    rule: vuln.VulnerabilityID || 'unknown-cve',
    severity: HIGH_OR_CRITICAL.has(vuln.Severity) ? 'error' : 'warning',
    message: formatTrivyVulnMessage(vuln),
  };
}

function misconfigFinding(target, misconf) {
  return {
    file: target,
    line: misconf.CauseMetadata?.StartLine || 0,
    col: undefined,
    tag: 'INFRA',
    rule: misconf.ID || 'unknown-misconfig',
    severity: HIGH_OR_CRITICAL.has(misconf.Severity) ? 'error' : 'warning',
    message: misconf.Title || misconf.Message,
  };
}

function secretFinding(target, secret) {
  return {
    file: target,
    line: secret.StartLine || 0,
    col: undefined,
    tag: 'SECRET',
    rule: secret.RuleID || 'secret',
    severity: 'error',
    message: `${secret.Category}: ${secret.Title} (match: ${secret.Match?.slice(0, 30)}...)`,
  };
}

function licenseFinding(target, lic) {
  return {
    file: target,
    line: 0,
    col: undefined,
    tag: 'LICENSE',
    rule: lic.Name || 'unknown-license',
    severity: 'error',
    message: `Restrictive license: ${lic.PkgName} uses ${lic.Name} (${lic.Severity}). Consider replacing with an MIT/Apache-2.0 alternative`,
  };
}

export default {
  name: 'trivy',
  extensions: ['.py', '.js', '.ts', '.go', '.java', '.rb', '.php', '.tf', '.yaml', '.yml', '.rs', '.kt', '.kts', '.cs', '.c', '.cpp', '.swift', '.sql'],
  installHint: 'curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b ~/.local/bin',

  buildCommand(targetDir, configPath, { files: _files = [], fix: _fix = false, licenses = false, updateDb = false } = {}) {
    const scanners = licenses ? 'vuln,misconfig,secret,license' : 'vuln,misconfig,secret';
    const args = [
      'fs',
      '--scanners', scanners,
      '--format', 'json',
      '--quiet',
    ];
    if (!updateDb) {
      args.push(
        '--offline-scan',
        '--skip-db-update',
        '--skip-java-db-update',
        '--skip-check-update',
        '--skip-vex-repo-update',
      );
    }
    if (configPath) args.push('--config', configPath);
    // trivy scans the full directory (ignores files arg — same pattern as jscpd)
    args.push(targetDir);
    return { bin: 'trivy', args };
  },

  parseOutput(stdout, stderr, exitCode) {
    if (!stdout.trim()) {
      if (exitCode > 0 && stderr.trim()) {
        throw new Error(formatTrivyError(stderr));
      }
      return [];
    }
    const data = parseTrivyJson(stdout);
    return (data.Results || []).flatMap(toEntryFindings);
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
