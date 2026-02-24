import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const FORMAT_RULES = /indentation|whitespace|empty-line|no-eol|no-missing-end-of-source-newline|no-extra-semicolons/;

function classifyRule(rule) {
  if (!rule) return 'LINTER';
  if (FORMAT_RULES.test(rule)) return 'FORMAT';
  return 'LINTER';
}

export default {
  name: 'stylelint',
  extensions: ['.css', '.scss', '.sass', '.less'],
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
    return { bin: 'stylelint', args };
  },

  parseOutput(stdout, stderr, exitCode) {
    // 0=clean, 2=lint problems, 1=fatal, 78=bad config, 64=bad CLI
    if ((exitCode === 1 || exitCode === 78 || exitCode === 64) && !stdout.trim()) {
      throw new Error(`stylelint error (exit ${exitCode}): ${(stderr || '').slice(0, 500)}`);
    }

    if (!stdout.trim()) return [];

    let results;
    try {
      results = JSON.parse(stdout);
    } catch {
      throw new Error(`stylelint: failed to parse JSON output: ${stdout.slice(0, 200)}`);
    }

    const findings = [];
    for (const fileResult of results) {
      if (!fileResult.warnings || fileResult.warnings.length === 0) continue;

      for (const warn of fileResult.warnings) {
        findings.push({
          file: fileResult.source,
          line: warn.line || 0,
          col: warn.column || undefined,
          tag: classifyRule(warn.rule),
          rule: warn.rule || 'unknown',
          severity: warn.severity === 'error' ? 'error' : 'warning',
          message: warn.text,
        });
      }
    }

    return findings;
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
