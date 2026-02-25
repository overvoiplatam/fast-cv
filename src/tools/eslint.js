import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SECURITY_RULES = new Set([
  'no-eval', 'no-implied-eval', 'no-new-func',
  'no-script-url', 'no-proto', 'no-caller', 'no-extend-native',
]);

const REFACTOR_RULES = new Set([
  'complexity', 'max-depth', 'max-lines-per-function',
  'max-lines', 'max-nested-callbacks', 'max-params', 'max-statements',
]);

const BUG_RULES = new Set([
  'no-unreachable', 'no-unreachable-loop', 'no-unused-vars',
  'no-constant-condition', 'no-dupe-keys', 'no-duplicate-case',
]);

const SONARJS_BUG_RULES = new Set([
  'sonarjs/no-all-duplicated-branches',
  'sonarjs/no-element-overwrite',
  'sonarjs/no-empty-collection',
  'sonarjs/no-extra-arguments',
  'sonarjs/no-identical-conditions',
  'sonarjs/no-identical-expressions',
  'sonarjs/no-ignored-return',
  'sonarjs/no-one-iteration-loop',
  'sonarjs/no-use-of-empty-return-value',
  'sonarjs/non-existent-operator',
]);

const SONARJS_REFACTOR_RULES = new Set([
  'sonarjs/cognitive-complexity',
  'sonarjs/max-switch-cases',
  'sonarjs/no-collapsible-if',
  'sonarjs/no-duplicate-string',
  'sonarjs/no-duplicated-branches',
  'sonarjs/no-identical-functions',
  'sonarjs/no-nested-switch',
  'sonarjs/no-nested-template-literals',
  'sonarjs/no-redundant-boolean',
  'sonarjs/no-redundant-jump',
  'sonarjs/no-same-line-conditional',
  'sonarjs/no-small-switch',
  'sonarjs/no-unused-collection',
  'sonarjs/no-useless-catch',
  'sonarjs/prefer-immediate-return',
  'sonarjs/prefer-object-literal',
  'sonarjs/prefer-single-boolean-return',
  'sonarjs/prefer-while',
]);

function classifyRule(ruleId) {
  if (!ruleId) return 'LINTER';
  // sonarjs rules — check before generic sets
  if (SONARJS_BUG_RULES.has(ruleId)) return 'BUG';
  if (SONARJS_REFACTOR_RULES.has(ruleId)) return 'REFACTOR';
  if (ruleId.startsWith('sonarjs/')) return 'REFACTOR';
  // Core eslint rules
  if (SECURITY_RULES.has(ruleId)) return 'SECURITY';
  if (REFACTOR_RULES.has(ruleId)) return 'REFACTOR';
  if (BUG_RULES.has(ruleId)) return 'BUG';
  if (ruleId.startsWith('security/')) return 'SECURITY';
  return 'LINTER';
}

export default {
  name: 'eslint',
  extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.svelte', '.vue', '.json', '.jsonc'],
  installHint: 'npm install -g eslint eslint-plugin-security eslint-plugin-sonarjs',

  buildCommand(targetDir, configPath, { files = [], fix = false } = {}) {
    const args = ['--format', 'json'];
    if (fix) args.push('--fix');
    if (configPath) {
      args.push('--config', configPath);
    }
    if (files.length > 0) {
      args.push(...files);
    } else {
      args.push(targetDir);
    }
    return { bin: 'eslint', args, cwd: targetDir };
  },

  parseOutput(stdout, stderr, exitCode) {
    // eslint exits: 0 = clean, 1 = findings, 2 = fatal error
    if (exitCode === 2 && !stdout.trim()) {
      throw new Error(`eslint error: ${stderr.slice(0, 500)}`);
    }

    if (!stdout.trim()) return [];

    let results;
    try {
      results = JSON.parse(stdout);
    } catch {
      throw new Error(`eslint: failed to parse JSON output: ${stdout.slice(0, 200)}`);
    }

    const findings = [];
    for (const fileResult of results) {
      if (!fileResult.messages || fileResult.messages.length === 0) continue;

      for (const msg of fileResult.messages) {
        // ESLint v9 flat config emits this for files with no matching config — not a real finding
        if (!msg.ruleId && msg.message && msg.message.includes('no matching configuration was supplied')) continue;

        findings.push({
          file: fileResult.filePath,
          line: msg.line || 0,
          col: msg.column || undefined,
          tag: classifyRule(msg.ruleId),
          rule: msg.ruleId || 'parse-error',
          severity: msg.severity === 2 ? 'error' : 'warning',
          message: msg.message,
        });
      }
    }

    return findings;
  },

  async checkInstalled() {
    try {
      await execFileAsync('eslint', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
