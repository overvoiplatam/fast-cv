import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseJsonLines } from '../constants.js';

const execFileAsync = promisify(execFile);

// mypy ≥ 1.11 (June 2024) added `--output json`. Older versions reject it,
// so we detect support once during checkInstalled and branch accordingly.
let supportsJsonOutput = false;

async function detectJsonSupport() {
  try {
    const { stdout } = await execFileAsync('mypy', ['--version']);
    const m = stdout.match(/mypy (\d+)\.(\d+)/);
    if (!m) return false;
    const major = Number(m[1]);
    const minor = Number(m[2]);
    return major > 1 || (major === 1 && minor >= 11);
  } catch {
    return false;
  }
}

// Plain-text mypy line: file:line[:col]: severity: message  [code]
// Last 1 or 2 numeric `:N` segments before the severity are line and optional column.
// File paths may contain colons (Windows drive letters), so scan from the right.
function parseMypyTextLine(line) {
  const sevMatch = line.match(/: (error|warning|note): /);
  if (!sevMatch) return null;
  const sevIdx = sevMatch.index;
  const severity = sevMatch[1];
  if (severity === 'note') return null;

  const head = line.slice(0, sevIdx);
  const tail = line.slice(sevIdx + sevMatch[0].length);

  // Walk colons from the right to find the line/col split.
  const lastColon = head.lastIndexOf(':');
  if (lastColon < 0) return null;
  const lastSegment = head.slice(lastColon + 1);
  const secondLastColon = head.lastIndexOf(':', lastColon - 1);
  const secondLastSegment = secondLastColon >= 0 ? head.slice(secondLastColon + 1, lastColon) : null;

  let file, lineNum, col;
  if (secondLastSegment !== null && /^\d+$/.test(secondLastSegment) && /^\d+$/.test(lastSegment)) {
    file = head.slice(0, secondLastColon);
    lineNum = Number(secondLastSegment);
    col = Number(lastSegment);
  } else if (/^\d+$/.test(lastSegment)) {
    file = head.slice(0, lastColon);
    lineNum = Number(lastSegment);
  } else {
    return null;
  }
  if (!file) return null;

  // Trailing `  [code]` (mypy uses two spaces, but tolerate one).
  let message = tail;
  let code = 'type-error';
  const codeMatch = tail.match(/\s+\[([a-z][a-z0-9-]*)\]\s*$/);
  if (codeMatch) {
    code = codeMatch[1];
    message = tail.slice(0, codeMatch.index);
  }

  return { file, line: lineNum, col, severity, code, message: message.trim() };
}

function findingFromJsonItem(item) {
  return {
    file: item.file,
    line: item.line || 0,
    col: item.column || undefined,
    tag: 'TYPE_ERROR',
    rule: item.code || 'type-error',
    severity: 'error',
    message: item.message,
  };
}

function findingFromTextParsed(p) {
  return {
    file: p.file,
    line: p.line,
    col: p.col,
    tag: 'TYPE_ERROR',
    rule: p.code,
    severity: p.severity === 'error' ? 'error' : 'warning',
    message: p.message,
  };
}

export default {
  name: 'mypy',
  extensions: ['.py', '.pyi'],
  installHint: 'pipx install mypy  (or: pip3 install --user mypy)',

  buildCommand(targetDir, configPath, { files = [] } = {}) {
    const args = ['--no-error-summary'];
    if (supportsJsonOutput) args.unshift('--output', 'json');
    if (configPath) args.push('--config-file', configPath);
    if (files.length > 0) {
      args.push(...files);
    } else {
      args.push(targetDir);
    }
    return { bin: 'mypy', args, cwd: targetDir };
  },

  parseOutput(stdout, stderr, exitCode) {
    if (!stdout.trim()) {
      if (exitCode === 2 && stderr.trim()) {
        throw new Error(`mypy error: ${stderr.slice(0, 500)}`);
      }
      return [];
    }

    if (supportsJsonOutput) {
      return parseJsonLines(stdout)
        .filter(item => item.severity === 'error')
        .map(findingFromJsonItem);
    }

    const findings = [];
    for (const raw of stdout.split('\n')) {
      const p = parseMypyTextLine(raw);
      if (p && p.severity === 'error') findings.push(findingFromTextParsed(p));
    }
    return findings;
  },

  async checkInstalled() {
    try {
      await execFileAsync('mypy', ['--version']);
      supportsJsonOutput = await detectJsonSupport();
      return true;
    } catch {
      return false;
    }
  },

  // Test hook: lets tests force the JSON/text branch without spawning mypy.
  _setJsonSupportForTests(value) {
    supportsJsonOutput = Boolean(value);
  },
};
