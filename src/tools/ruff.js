import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function classifyRule(code) {
  if (!code) return 'LINTER';
  // Refactor rules (must check multi-char prefixes before single-char)
  if (/^(SIM|UP|PERF|C4|RET|PIE|C90|PLR|PTH|ERA|ARG)/.test(code)) return 'REFACTOR';
  // Security rules (S prefix, but not SIM/etc — checked after multi-char)
  if (/^S\d/.test(code)) return 'SECURITY';
  // Format rules (pycodestyle errors/warnings, isort)
  if (/^[EWI]\d/.test(code)) return 'FORMAT';
  // Documentation rules (pydocstyle)
  if (/^D\d/.test(code)) return 'DOCS';
  // Bug detection (bugbear B*, blind-except BLE*, builtins A*, ruff-specific RUF*)
  if (/^(B|RUF|A\d)/.test(code)) return 'BUG';
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

  buildCommand(targetDir, configPath, { files = [], fix = false } = {}) {
    const args = ['check', '--output-format', 'json'];
    args.push(fix ? '--fix' : '--no-fix');
    if (configPath) {
      args.push('--config', configPath);
    }
    if (files.length > 0) {
      args.push(...files);
    } else {
      args.push(targetDir);
    }
    return { bin: 'ruff', args, cwd: targetDir };
  },

  preFixCommands(targetDir, configPath, { files = [] } = {}) {
    const args = ['format'];
    if (configPath) {
      args.push('--config', configPath);
    }
    if (files.length > 0) {
      args.push(...files);
    } else {
      args.push(targetDir);
    }
    return [{ bin: 'ruff', args, cwd: targetDir }];
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
