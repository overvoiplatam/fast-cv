import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const FORMAT_RULES = /indentation|whitespace|empty-line|no-eol|no-missing-end-of-source-newline|no-extra-semicolons/;

function classifyRule(rule) {
  if (!rule) return 'LINTER';
  if (FORMAT_RULES.test(rule)) return 'FORMAT';
  return 'LINTER';
}

const STYLELINT_FATAL_EXITS = new Set([1, 78, 64]);

function parseStylelintJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`stylelint: failed to parse JSON output: ${stdout.slice(0, 200)}`);
  }
}

function toStylelintFindings(fileResult) {
  if (!fileResult.warnings || fileResult.warnings.length === 0) return [];
  return fileResult.warnings.map(warn => ({
    file: fileResult.source,
    line: warn.line || 0,
    col: warn.column || undefined,
    tag: classifyRule(warn.rule),
    rule: warn.rule || 'unknown',
    severity: warn.severity === 'error' ? 'error' : 'warning',
    message: warn.text,
  }));
}

export default {
  name: 'stylelint',
  extensions: ['.css', '.scss', '.sass', '.less'],
  supportsFix: true,
  installHint: 'npm install -g stylelint stylelint-config-standard',

  buildCommand(targetDir, configPath, { files = [], fix = false } = {}) {
    const args = ['--formatter', 'json', '--allow-empty-input'];
    if (configPath) args.push('--config', configPath);
    if (fix) args.push('--fix');
    if (files.length > 0) {
      args.push(...files);
    } else {
      args.push(targetDir + '/**/*.{css,scss,sass,less}');
    }
    return { bin: 'stylelint', args, cwd: targetDir };
  },

  parseOutput(stdout, stderr, exitCode) {
    // 0=clean, 2=lint problems, 1=fatal, 78=bad config, 64=bad CLI
    if (STYLELINT_FATAL_EXITS.has(exitCode) && !stdout.trim()) {
      throw new Error(`stylelint error (exit ${exitCode}): ${(stderr || '').slice(0, 500)}`);
    }
    if (!stdout.trim()) return [];
    return parseStylelintJson(stdout).flatMap(toStylelintFindings);
  },

  async checkInstalled() {
    try {
      await execFileAsync('stylelint', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
