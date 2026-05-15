import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function isKnipProjectIssue(stderr) {
  if (!stderr) return false;
  return stderr.includes('Unable to find') || stderr.includes('no such file');
}

function parseKnipJson(stdout) {
  try {
    // Strip non-JSON prefix (e.g. Svelte config warnings printed before JSON)
    const jsonStart = stdout.indexOf('{');
    const raw = jsonStart > 0 ? stdout.slice(jsonStart) : stdout;
    return JSON.parse(raw);
  } catch {
    throw new Error(`knip: failed to parse JSON output: ${stdout.slice(0, 200)}`);
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
      if (isKnipProjectIssue(stderr)) return [];
      if (exitCode >= 2 && stderr.trim()) {
        throw new Error(`knip error (exit ${exitCode}): ${stderr.slice(0, 500)}`);
      }
      return [];
    }
    const data = parseKnipJson(stdout);
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
