import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function classifySemgrepSeverity(metadata) {
  const category = metadata?.category || '';
  const impact = metadata?.impact || '';
  const confidence = metadata?.confidence || '';

  if (category === 'security' || impact === 'HIGH' || impact === 'MEDIUM') return 'SECURITY';
  if (category === 'correctness') return 'BUG';
  return 'SECURITY'; // semgrep is primarily a security tool
}

export default {
  name: 'semgrep',
  extensions: ['.py', '.js', '.jsx', '.ts', '.tsx', '.go', '.java', '.rb'],
  installHint: 'pipx install semgrep  (or: pip3 install --user semgrep)',

  buildCommand(targetDir, configPath) {
    const args = ['scan', '--json', '--quiet'];
    if (configPath) {
      args.push('--config', configPath);
    } else {
      args.push('--config', 'auto');
    }
    args.push(targetDir);
    return { bin: 'semgrep', args };
  },

  parseOutput(stdout, stderr, exitCode) {
    // semgrep exits: 0 = clean or findings, 1 = findings with errors, 2+ = fatal
    if (!stdout.trim()) {
      if (exitCode >= 2) {
        throw new Error(`semgrep error (exit ${exitCode}): ${stderr.slice(0, 500)}`);
      }
      return [];
    }

    let data;
    try {
      data = JSON.parse(stdout);
    } catch {
      throw new Error(`semgrep: failed to parse JSON output: ${stdout.slice(0, 200)}`);
    }

    const results = data.results || [];
    return results.map(item => ({
      file: item.path,
      line: item.start?.line || 0,
      col: item.start?.col || undefined,
      tag: classifySemgrepSeverity(item.extra?.metadata),
      rule: item.check_id || 'unknown',
      severity: item.extra?.severity === 'ERROR' ? 'error' : 'warning',
      message: item.extra?.message || item.extra?.metadata?.message || 'Issue detected',
    }));
  },

  async checkInstalled() {
    try {
      await execFileAsync('semgrep', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
