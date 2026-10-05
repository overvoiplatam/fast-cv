import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { majorFromVersion, parseLeadingJson, resolveReportedPath } from '../adapter-helpers.js';

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

const TOOL_NAME = 'golangci-lint';

function classifyLinter(linterName) {
  if (!linterName) return 'LINTER';
  if (REFACTOR_LINTERS.has(linterName)) return 'REFACTOR';
  if (BUG_LINTERS.has(linterName)) return 'BUG';
  if (SECURITY_LINTERS.has(linterName)) return 'SECURITY';
  if (DOCS_LINTERS.has(linterName)) return 'DOCS';
  return 'LINTER';
}

export default {
  name: TOOL_NAME,
  extensions: ['.go'],
  supportsFix: true,
  installHint: `curl -sSfL https://raw.githubusercontent.com/golangci/${TOOL_NAME}/master/install.sh | sh -s -- -b ~/.local/bin`,

  // golangci-lint v2 removed the v1 `--out-format` flag and changed the
  // config schema, so behavior branches on the detected major. Set by
  // checkInstalled() (the runner invokes it before every run); tests may
  // set it directly to drive either branch. 0 = not yet probed → assume
  // the older flag set, which v2 still tolerates as a deprecated alias.
  detectedMajor: 0,

  buildCommand(targetDir, configPath, { files = [], fix = false } = {}) {
    // v2 writes JSON through --output.json.path; v1 uses --out-format json.
    const args = this.detectedMajor >= 2
      ? ['run', '--output.json.path', 'stdout']
      : ['run', '--out-format', 'json'];
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
    return { bin: TOOL_NAME, args, cwd: targetDir };
  },

  parseOutput(stdout, stderr, exitCode, { targetDir } = {}) {
    // golangci-lint exits: 0 = clean, 1 = findings, >1 = error
    if (!stdout.trim()) {
      if (exitCode > 1) {
        throw new Error(`${TOOL_NAME} error (exit ${exitCode}): ${stderr.slice(0, 500)}`);
      }
      return [];
    }

    let data;
    try {
      // v2 appends a human suffix ("0 issues.") after the JSON document;
      // parseLeadingJson extracts the first balanced object wherever it sits.
      data = parseLeadingJson(stdout);
    } catch {
      throw new Error(`${TOOL_NAME}: failed to parse JSON output: ${stdout.slice(0, 200)}`);
    }

    const issues = data.Issues || [];
    return issues.map(item => ({
      // v2 relativizes Pos.Filename against a base of its own choosing (not
      // necessarily the spawn cwd), so a plain relative path can escape the
      // target with ../ segments and break the ignore() contract downstream.
      // Recover the real location from the plausible bases.
      file: resolveReportedPath(item.Pos?.Filename || 'unknown', { targetDir }),
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
      const { stdout } = await execFileAsync(TOOL_NAME, ['--version']);
      // No dotted version in the output → assume the legacy v1 flag path.
      this.detectedMajor = majorFromVersion(stdout) ?? 1;
      return true;
    } catch {
      this.detectedMajor = 0;
      return false;
    }
  },
};
