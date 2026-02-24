import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function classifyRule(code) {
  if (!code) return 'LINTER';
  // Refactor rules (must check before S* to avoid SIM matching SECURITY)
  if (/^(SIM|UP|PERF|C4|RET|PIE)/.test(code)) return 'REFACTOR';
  // Security rules (S prefix, but not SIM/etc)
  if (/^S\d/.test(code)) return 'SECURITY';
  // Format rules (pycodestyle errors/warnings, isort)
  if (/^[EWI]\d/.test(code)) return 'FORMAT';
  // Bugbear
  if (code.startsWith('B')) return 'BUG';
  // Default: linter
  return 'LINTER';
}

function mapSeverity(ruffSeverity) {
  // ruff JSON uses "E" for error, "W" for warning in the type field
  // but the main signal is the rule code
  return ruffSeverity === 'E' ? 'error' : 'warning';
}

export default {
  name: 'ruff',
  extensions: ['.py', '.pyi'],
  installHint: 'pipx install ruff  (or: pip3 install --user ruff)',

  buildCommand(targetDir, configPath) {
    const args = ['check', '--output-format', 'json', '--no-fix'];
    if (configPath) {
      args.push('--config', configPath);
    }
    args.push(targetDir);
    return { bin: 'ruff', args };
  },

  parseOutput(stdout, stderr, exitCode) {
    // ruff exits 0 = clean, 1 = findings, 2 = error
    if (exitCode === 2 && !stdout.trim()) {
      throw new Error(`ruff error: ${stderr.slice(0, 500)}`);
    }

    if (!stdout.trim()) return [];

    let results;
    try {
      results = JSON.parse(stdout);
    } catch {
      throw new Error(`ruff: failed to parse JSON output: ${stdout.slice(0, 200)}`);
    }

    return results.map(item => ({
      file: item.filename,
      line: item.location?.row ?? item.location?.line ?? 0,
      col: item.location?.column ?? item.location?.col ?? undefined,
      tag: classifyRule(item.code),
      rule: item.code || 'unknown',
      severity: mapSeverity(item.type),
      message: item.message,
    }));
  },

  async checkInstalled() {
    try {
      await execFileAsync('ruff', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
