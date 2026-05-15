import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function mapSeverity(s) {
  if (s === 'error') return 'error';
  return 'warning';
}

function throwIfValeConfigError(raw) {
  if (!raw.startsWith('{')) return;
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return;  // not parseable as a config-error object; fall through to normal handling
  }
  if (!obj || typeof obj !== 'object') return;
  if (typeof obj.Code !== 'string' || !obj.Code.startsWith('E')) return;
  const hint = obj.Code === 'E201'
    ? 'run `vale sync` in your Vale config directory to populate styles'
    : 'check your .vale.ini configuration';
  throw new Error(`vale ${obj.Code}: ${obj.Text || 'config error'} — ${hint}`);
}

function parseValeJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`vale: failed to parse JSON output: ${stdout.slice(0, 200)}`);
  }
}

function toValeFindings(file, items) {
  if (!Array.isArray(items)) return [];
  return items.map(item => makeValeFinding(file, item));
}

function makeValeFinding(file, item) {
  const span = Array.isArray(item.Span) ? item.Span : [];
  return {
    file,
    line: Number.isFinite(item.Line) ? item.Line : 1,
    col: Number.isFinite(span[0]) ? span[0] : undefined,
    tag: 'DOCS',
    rule: `vale/${item.Check || 'unknown'}`,
    severity: mapSeverity(item.Severity),
    message: item.Message || '',
  };
}

export default {
  name: 'vale',
  extensions: ['.md', '.markdown', '.rst', '.adoc', '.txt'],
  installHint: 'brew install vale  (or: go install github.com/errata-ai/vale/v3@latest)',

  buildCommand(targetDir, configPath, { files = [] } = {}) {
    const args = ['--output=JSON'];
    if (configPath) args.push('--config', configPath);
    const relevant = files.filter(f => /\.(md|markdown|rst|adoc|txt)$/i.test(f));
    if (relevant.length > 0) args.push(...relevant);
    else args.push(targetDir);
    return { bin: 'vale', args, cwd: targetDir };
  },

  parseOutput(stdout, stderr, exitCode) {
    const raw = stdout.trim() || stderr.trim();
    if (!raw) return [];

    // Vale emits config/style errors as a single non-array JSON object
    // (usually on stderr). Surface those as actionable tool errors.
    throwIfValeConfigError(raw);

    if (!stdout.trim()) {
      if (exitCode > 1 && stderr.trim()) {
        throw new Error(`vale error (exit ${exitCode}): ${stderr.slice(0, 500)}`);
      }
      return [];
    }

    const doc = parseValeJson(stdout);
    if (!doc || typeof doc !== 'object') return [];
    return Object.entries(doc).flatMap(([file, items]) => toValeFindings(file, items));
  },

  async checkInstalled() {
    try {
      await execFileAsync('vale', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
