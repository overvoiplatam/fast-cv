import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Detects knip's own bootstrap-failure stderr text. "Error loading <path>" is
// emitted by knip when it can't load a project config file; "Unable to find"
// and "no such file" are knip's missing-config diagnostics. We deliberately
// avoid matching Node.js `MODULE_NOT_FOUND` strings on their own — those can
// also indicate a knip-internal regression.
//
// Implemented with indexOf/slice (line-by-line) rather than lazy regex like
// `.+?` — that pattern trips sonarjs/slow-regex.
const LOAD_PREFIX = 'Error loading ';
const REASON_PREFIX = 'Reason:';

function stripCR(line) {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function extractFailingPath(line) {
  const idx = line.indexOf(LOAD_PREFIX);
  return idx >= 0 ? line.slice(idx + LOAD_PREFIX.length).trim() : null;
}

function extractReason(line) {
  return line.startsWith(REASON_PREFIX) ? line.slice(REASON_PREFIX.length).trim() : null;
}

function isUnableLine(line) {
  return line.includes('Unable to find') || line.includes('no such file');
}

function detectKnipBootstrapFailure(stderr) {
  if (!stderr) return null;
  let failingPath = null;
  let reason = null;
  let unableLine = null;
  for (const raw of stderr.split('\n')) {
    const line = stripCR(raw);
    if (failingPath === null) failingPath = extractFailingPath(line);
    if (reason === null) reason = extractReason(line);
    if (unableLine === null && isUnableLine(line)) unableLine = line.trim();
  }
  if (failingPath !== null) {
    if (failingPath.includes('node_modules/knip/')) return null;
    return { file: failingPath, reason: reason || stderr.trim().slice(0, 200) };
  }
  if (unableLine !== null) return { file: 'knip', reason: unableLine };
  return null;
}

function bootstrapFailureFinding({ file, reason }) {
  return {
    file: file || 'knip',
    line: 0,
    col: undefined,
    tag: 'LINTER',
    rule: 'bootstrap-failure',
    severity: 'error',
    message: `knip could not load config: ${reason}. Install the target project's dependencies or fix the config.`,
  };
}

function parseKnipJson(stdout, stderr) {
  try {
    // Strip non-JSON prefix (e.g. Svelte config warnings printed before JSON)
    const jsonStart = stdout.indexOf('{');
    const raw = jsonStart > 0 ? stdout.slice(jsonStart) : stdout;
    return JSON.parse(raw);
  } catch {
    const bootstrap = detectKnipBootstrapFailure(stderr);
    if (bootstrap) return { __bootstrapFailure: bootstrap };
    // The real diagnostic is usually on stderr (config load failures, plugin
    // errors). Surface it alongside stdout so users can act on it.
    const parts = ['knip: failed to parse JSON output.'];
    const errTrim = (stderr || '').trim();
    if (errTrim) parts.push(`stderr: ${errTrim.slice(0, 500)}`);
    parts.push(`stdout: ${stdout.slice(0, 500)}`);
    throw new Error(parts.join('\n'));
  }
}

function unusedFileFinding(file) {
  return {
    file,
    line: 0,
    col: undefined,
    tag: 'DEAD_CODE',
    rule: 'knip/unused-file',
    severity: 'warning',
    message: 'Unused file — not imported or referenced by any other module',
  };
}

function unusedExportFinding(item) {
  return {
    file: item.file || item.path || 'unknown',
    line: item.line || item.row || 0,
    col: item.col || undefined,
    tag: 'DEAD_CODE',
    rule: 'knip/unused-export',
    severity: 'warning',
    message: `Unused export: ${item.name || item.symbol || 'unknown'}`,
  };
}

function packageFinding(item, ruleSuffix, label) {
  return {
    file: 'package.json',
    line: 0,
    col: undefined,
    tag: 'DEAD_CODE',
    rule: `knip/${ruleSuffix}`,
    severity: 'warning',
    message: `${label}: ${item.name || item}`,
  };
}

export default {
  name: 'knip',
  extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
  supportsFix: true,
  installHint: 'npm install -g knip',

  buildCommand(targetDir, _configPath, { fix = false } = {}) {
    const args = ['--reporter', 'json', '--no-progress'];
    if (fix) args.push('--fix');
    return {
      bin: 'knip',
      args,
      cwd: targetDir,
    };
  },

  parseOutput(stdout, stderr, exitCode) {
    // knip exits: 0 = clean, 1 = findings, 2+ = error
    if (!stdout.trim()) {
      const bootstrap = detectKnipBootstrapFailure(stderr);
      if (bootstrap) return [bootstrapFailureFinding(bootstrap)];
      if (exitCode >= 2 && stderr.trim()) {
        throw new Error(`knip error (exit ${exitCode}): ${stderr.slice(0, 500)}`);
      }
      return [];
    }
    const data = parseKnipJson(stdout, stderr);
    if (data.__bootstrapFailure) return [bootstrapFailureFinding(data.__bootstrapFailure)];
    return [
      ...(data.files || []).map(unusedFileFinding),
      ...(data.exports || []).map(unusedExportFinding),
      ...(data.dependencies || []).map(item => packageFinding(item, 'unused-dependency', 'Unused dependency')),
      ...(data.unlisted || []).map(item => packageFinding(item, 'unlisted-dependency', 'Unlisted dependency')),
    ];
  },

  async checkInstalled() {
    try {
      await execFileAsync('knip', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
