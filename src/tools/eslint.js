import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// eslint 9 is the first release that reads flat config by default.
const MIN_ESLINT_MAJOR = 9;

// The shipped default config prints degradation notices with this prefix on
// stderr when an optional extra (plugin/peer) is missing — see
// defaults/eslint.config.mjs. The runner otherwise discards the stderr of a
// successful tool run, so the adapter surveils this prefix and surfaces the
// lines as report-level warnings; a silently disabled sampler is exactly the
// kind of information users otherwise never learn.
const CONFIG_NOTICE_PREFIX = '[fast-cv eslint defaults]';

// One or more lines of `stderr` starting with CONFIG_NOTICE_PREFIX, to be
// reported as [WARN] entries in the final report (deduped: callers may run
// eslint more than once per scan; one degraded extra should produce one
// warning, not one per invocation).
function extractConfigNotices(stderr) {
  if (!stderr || !String(stderr).includes(CONFIG_NOTICE_PREFIX)) return [];
  return [...new Set(
    String(stderr).split(/\r?\n/)
      .filter(line => line.startsWith(CONFIG_NOTICE_PREFIX))
      .map(line => line.trim())
      .filter(Boolean),
  )];
}

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

function parseEslintJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`eslint: failed to parse JSON output: ${stdout.slice(0, 200)}`);
  }
}

function collectEslintFindings(fileResult) {
  if (!fileResult.messages || fileResult.messages.length === 0) return [];
  const out = [];
  for (const msg of fileResult.messages) {
    if (isUnmatchedConfigMessage(msg)) continue;
    out.push(makeEslintFinding(fileResult.filePath, msg));
  }
  return out;
}

// ESLint v9 flat config emits this for files with no matching config —
// not a real finding.
function isUnmatchedConfigMessage(msg) {
  return !msg.ruleId
    && typeof msg.message === 'string'
    && msg.message.includes('no matching configuration was supplied');
}

function makeEslintFinding(filePath, msg) {
  return {
    file: filePath,
    line: msg.line || 0,
    col: msg.column || undefined,
    tag: classifyRule(msg.ruleId),
    rule: msg.ruleId || 'parse-error',
    severity: msg.severity === 2 ? 'error' : 'warning',
    message: msg.message,
  };
}

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
  if (ruleId.startsWith('jsdoc/')) return 'DOCS';
  return 'LINTER';
}

export default {
  name: 'eslint',
  extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.svelte', '.vue', '.json', '.jsonc'],
  supportsFix: true,
  installHint: 'npm install -g eslint eslint-plugin-security eslint-plugin-sonarjs eslint-plugin-jsonc',

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

    // The shipped default config degrades gracefully — absent plugins make it
    // print one stderr line per disabled extra (see defaults/eslint.config.mjs).
    // Those lines are otherwise lost: a tool without findings has its stderr
    // discarded. Surface them as report-level warnings instead — they carry
    // the exact "silent degradation" news that looks like a bug to users.
    const notices = extractConfigNotices(stderr);
    const findings = stdout.trim() ? parseEslintJson(stdout).flatMap(f => collectEslintFindings(f)) : [];

    if (notices.length > 0) return { findings, warnings: notices };
    return findings;
  },

  async checkInstalled() {
    let stdout;
    try {
      ({ stdout } = await execFileAsync('eslint', ['--version']));
    } catch {
      return false;
    }
    // Our shipped default is a flat config (eslint.config.mjs), which only
    // eslint 9+ reads by default. Older versions try to parse it as YAML and
    // die with a js-yaml stack trace — report the real cause instead.
    const major = Number(/^v?(\d+)\./.exec(stdout.trim())?.[1]);
    if (Number.isInteger(major) && major < MIN_ESLINT_MAJOR) {
      return {
        ok: false,
        reason: `found v${stdout.trim().replace(/^v/, '')}, but flat config needs eslint >= ${MIN_ESLINT_MAJOR}`,
      };
    }
    return true;
  },
};
