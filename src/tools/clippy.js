import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseJsonLines } from '../constants.js';

const execFileAsync = promisify(execFile);

const BUG_KEYWORDS = /correctness|suspicious/;
const REFACTOR_KEYWORDS = /perf|complexity/;

function classifyLint(lintName) {
  if (!lintName) return 'LINTER';
  if (BUG_KEYWORDS.test(lintName)) return 'BUG';
  if (REFACTOR_KEYWORDS.test(lintName)) return 'REFACTOR';
  return 'LINTER';
}

export default {
  name: 'clippy',
  extensions: ['.rs'],
  installHint: 'rustup component add clippy',

  buildCommand(targetDir, _configPath, { fix = false } = {}) {
    const args = ['clippy'];
    if (fix) {
      args.push('--fix', '--allow-dirty', '--allow-staged');
    }
    args.push('--message-format=json', '--all-targets', '--all-features', '--', '--no-deps');
    return { bin: 'cargo', args, cwd: targetDir };
  },

  parseOutput(stdout, stderr, exitCode) {
    if (exitCode >= 101) {
      throw new Error(`clippy error (exit ${exitCode}): ${(stderr || stdout).slice(0, 500)}`);
    }

    if (!stdout.trim()) return [];

    const items = parseJsonLines(stdout);
    const findings = [];

    for (const item of items) {
      if (item.reason !== 'compiler-message') continue;
      const msg = item.message;
      if (!msg || msg.level === 'note') continue;

      const span = (msg.spans || []).find(s => s.is_primary) || msg.spans?.[0];
      if (!span) continue;

      const lintName = msg.code?.code || '';
      findings.push({
        file: span.file_name,
        line: span.line_start || 0,
        col: span.column_start || undefined,
        tag: classifyLint(lintName),
        rule: lintName || 'clippy',
        severity: msg.level === 'error' ? 'error' : 'warning',
        message: msg.message,
      });
    }

    return findings;
  },

  async checkInstalled() {
    try {
      await execFileAsync('cargo', ['clippy', '--version']);
      return true;
    } catch {
      return false;
    }
  },
};
