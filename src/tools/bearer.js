import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SKIP_PATHS = [
  'node_modules', 'vendor', '.yarn', 'bower_components',
  '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache',
  '.git', '.hg', '.svn',
  'dist', 'build', 'out', 'target', '_build',
  '.next', '.nuxt', '.angular',
  'coverage', '.cache',
];

const BEARER_HIGH_SEVERITIES = new Set(['critical', 'high']);

function parseBearerJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`bearer: failed to parse JSON output: ${stdout.slice(0, 200)}`);
  }
}

function toBearerFindings(item) {
  const locations = item.locations || [item];
  return locations.map(loc => makeBearerFinding(item, loc));
}

function makeBearerFinding(item, loc) {
  return {
    file: pickFileName(item, loc),
    line: pickLineNumber(loc),
    col: pickColumnNumber(loc),
    tag: 'PRIVACY',
    rule: item.rule_id || item.id || 'unknown',
    severity: BEARER_HIGH_SEVERITIES.has(item.severity) ? 'error' : 'warning',
    message: item.title || item.description || item.message || 'Privacy/data-flow issue detected',
  };
}

function pickFileName(item, loc) {
  return loc.filename || loc.file || item.filename || 'unknown';
}

function pickLineNumber(loc) {
  return loc.line_number || loc.start?.line || 0;
}

function pickColumnNumber(loc) {
  return loc.column_number || loc.start?.column || undefined;
}

export default {
  name: 'bearer',
  extensions: ['.py', '.js', '.jsx', '.ts', '.tsx', '.go', '.java', '.rb', '.php'],
  installHint: 'curl -sfL https://raw.githubusercontent.com/Bearer/bearer/main/contrib/install.sh | sh -s -- -b ~/.local/bin',

  buildCommand(targetDir, configPath, { files = [] } = {}) {
    const args = ['scan', '--format', 'json', '--quiet', '--hide-progress-bar'];
    for (const p of SKIP_PATHS) {
      args.push('--skip-path', p);
    }
    if (configPath) {
      args.push('--config-file', configPath);
    }
    if (files.length > 0) {
      args.push(...files);
    } else {
      args.push(targetDir);
    }
    return { bin: 'bearer', args, cwd: targetDir };
  },

  parseOutput(stdout, stderr, exitCode) {
    // bearer exits: 0 = clean, 1 = findings, 2+ = error
    if (!stdout.trim()) {
      if (exitCode >= 2) {
        throw new Error(`bearer error (exit ${exitCode}): ${stderr.slice(0, 500)}`);
      }
      return [];
    }
    const data = parseBearerJson(stdout);
    const items = data.warnings || data.findings || [];
    return items.flatMap(toBearerFindings);
  },

  async checkInstalled() {
    try {
      await execFileAsync('bearer', ['version']);
      return true;
    } catch {
      return false;
    }
  },
};
