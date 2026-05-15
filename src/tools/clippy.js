import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseJsonLines } from '../constants.js';

const execFileAsync = promisify(execFile);

const BUG_KEYWORDS = /correctness|suspicious/;
const REFACTOR_KEYWORDS = /perf|complexity/;

function classifyLint(lintName) {
  if (!lintName) return 'LINTER';
  if (lintName === 'missing_docs') return 'DOCS';
  if (BUG_KEYWORDS.test(lintName)) return 'BUG';
  if (REFACTOR_KEYWORDS.test(lintName)) return 'REFACTOR';
  return 'LINTER';
}

function makeClippyFinding(item) {
  if (item.reason !== 'compiler-message') return null;
  const msg = item.message;
  if (!msg || msg.level === 'note') return null;

  const span = pickPrimarySpan(msg.spans);
  if (!span) return null;

  const lintName = msg.code?.code || '';
  return {
    file: span.file_name,
    line: span.line_start || 0,
    col: span.column_start || undefined,
    tag: classifyLint(lintName),
    rule: lintName || 'clippy',
    severity: msg.level === 'error' ? 'error' : 'warning',
    message: msg.message,
  };
}

function pickPrimarySpan(spans) {
  if (!Array.isArray(spans) || spans.length === 0) return null;
  return spans.find(s => s.is_primary) || spans.at(0);
}

export default {
  name: 'clippy',
  extensions: ['.rs'],
  supportsFix: true,
  installHint: 'rustup component add clippy',

  buildCommand(targetDir, configPath, { fix = false } = {}) {
    const args = ['clippy'];
    if (fix) {
      args.push('--fix', '--allow-dirty', '--allow-staged');
    }
    args.push('--message-format=json', '--all-targets', '--all-features', '--', '--no-deps');
    if (!configPath) args.push('-W', 'missing-docs');
    return { bin: 'cargo', args, cwd: targetDir };
  },

  parseOutput(stdout, stderr, exitCode) {
    if (exitCode >= 101) {
      throw new Error(`clippy error (exit ${exitCode}): ${(stderr || stdout).slice(0, 500)}`);
    }
    if (!stdout.trim()) return [];

    const findings = [];
    for (const item of parseJsonLines(stdout)) {
      const finding = makeClippyFinding(item);
      if (finding) findings.push(finding);
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
