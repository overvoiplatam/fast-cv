import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export default {
  name: 'bearer',
  extensions: ['.py', '.js', '.jsx', '.ts', '.tsx', '.go', '.java', '.rb', '.php'],
  installHint: 'curl -sfL https://raw.githubusercontent.com/Bearer/bearer/main/contrib/install.sh | sh -s -- -b ~/.local/bin',

  buildCommand(targetDir, configPath) {
    const args = ['scan', '--format', 'json', '--quiet'];
    if (configPath) {
      args.push('--config-file', configPath);
    }
    args.push(targetDir);
    return { bin: 'bearer', args };
  },

  parseOutput(stdout, stderr, exitCode) {
    // bearer exits: 0 = clean, 1 = findings, 2+ = error
    if (!stdout.trim()) {
      if (exitCode >= 2) {
        throw new Error(`bearer error (exit ${exitCode}): ${stderr.slice(0, 500)}`);
      }
      return [];
    }

    let data;
    try {
      data = JSON.parse(stdout);
    } catch {
      throw new Error(`bearer: failed to parse JSON output: ${stdout.slice(0, 200)}`);
    }

    const findings = [];

    // Bearer outputs warnings array at top level or under specific keys
    const warnings = data.warnings || data.findings || [];
    for (const item of warnings) {
      const locations = item.locations || [item];
      for (const loc of locations) {
        findings.push({
          file: loc.filename || loc.file || item.filename || 'unknown',
          line: loc.line_number || loc.start?.line || 0,
          col: loc.column_number || loc.start?.column || undefined,
          tag: 'PRIVACY',
          rule: item.rule_id || item.id || 'unknown',
          severity: item.severity === 'critical' || item.severity === 'high' ? 'error' : 'warning',
          message: item.title || item.description || item.message || 'Privacy/data-flow issue detected',
        });
      }
    }

    return findings;
  },

  async checkInstalled() {
    try {
      await execFileAsync('bearer', ['version']);
      return true;
    } catch {
      return false;
    }
  },
};
