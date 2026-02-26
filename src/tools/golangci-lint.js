import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const REFACTOR_LINTERS = new Set([
  'gocognit', 'cyclop', 'funlen', 'gocyclo', 'maintidx', 'nestif',
]);

const BUG_LINTERS = new Set([
  'govet', 'staticcheck', 'ineffassign', 'unused', 'errcheck', 'bodyclose', 'nilerr',
]);

const SECURITY_LINTERS = new Set([
  'gosec',
]);

const DOCS_LINTERS = new Set([
  'revive',
]);

function classifyLinter(linterName) {
  if (!linterName) return 'LINTER';
  if (REFACTOR_LINTERS.has(linterName)) return 'REFACTOR';
  if (BUG_LINTERS.has(linterName)) return 'BUG';
  if (SECURITY_LINTERS.has(linterName)) return 'SECURITY';
  if (DOCS_LINTERS.has(linterName)) return 'DOCS';
  return 'LINTER';
}

export default {
  name: 'golangci-lint',
  extensions: ['.go'],
  supportsFix: true,
  installHint: 'curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b ~/.local/bin',

  buildCommand(targetDir, configPath, { files = [], fix = false } = {}) {
    const args = ['run', '--out-format', 'json'];
    if (configPath) {
      args.push('--config', configPath);
    } else {
      args.push('--enable', 'gocognit');
    }
    if (fix) args.push('--fix');
    if (files.length > 0) {
      args.push(...files);
    } else {
      args.push('./...');
    }
    return { bin: 'golangci-lint', args, cwd: targetDir };
  },

  parseOutput(stdout, stderr, exitCode) {
    // golangci-lint exits: 0 = clean, 1 = findings, >1 = error
    if (!stdout.trim()) {
      if (exitCode > 1) {
        throw new Error(`golangci-lint error (exit ${exitCode}): ${stderr.slice(0, 500)}`);
      }
      return [];
    }

    let data;
    try {
      data = JSON.parse(stdout);
    } catch {
      throw new Error(`golangci-lint: failed to parse JSON output: ${stdout.slice(0, 200)}`);
    }

    const issues = data.Issues || [];
    return issues.map(item => ({
      file: item.Pos?.Filename || 'unknown',
      line: item.Pos?.Line || 0,
      col: item.Pos?.Column || undefined,
      tag: classifyLinter(item.FromLinter),
      rule: item.FromLinter || 'unknown',
      severity: item.Severity === 'error' ? 'error' : 'warning',
      message: item.Text || 'Issue detected',
    }));
  },

  async checkInstalled() {
    try {
      await execFileAsync('golangci-lint', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
