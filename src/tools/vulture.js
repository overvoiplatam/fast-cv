import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Extract `<file>:<line>:` prefix from a trimmed line, scanning up to
// upperBound. Returns the file, line number, and the offset just past the
// trailing colon (so callers can slice the remainder). indexOf/slice avoids
// the `(.+?)` lazy quantifier that trips sonarjs/slow-regex.
function parseFileLinePrefix(trimmed, upperBound) {
  const fileEnd = findVultureFileEnd(trimmed, upperBound);
  if (fileEnd < 0) return null;
  const lineNumEnd = trimmed.indexOf(':', fileEnd + 1);
  if (lineNumEnd < 0) return null;
  const lineStr = trimmed.slice(fileEnd + 1, lineNumEnd);
  const lineNum = Number.parseInt(lineStr, 10);
  if (!Number.isFinite(lineNum) || String(lineNum) !== lineStr) return null;
  const file = trimmed.slice(0, fileEnd);
  if (file.length === 0) return null;
  return { file, line: lineNum, bodyStart: lineNumEnd + 1 };
}

// Manual parse of vulture stdout:
//   <file>:<line>: <body> (<conf>% confidence)
function parseVultureLine(line) {
  const trimmed = line.trimEnd();
  if (trimmed.length === 0) return null;

  // Suffix `(<conf>% confidence)` must be present at end.
  const SUFFIX_END = ' confidence)';
  if (!trimmed.endsWith(SUFFIX_END)) return null;
  const confEnd = trimmed.length - SUFFIX_END.length;
  const percentIdx = trimmed.lastIndexOf('%', confEnd - 1);
  if (percentIdx < 0) return null;
  const confOpen = trimmed.lastIndexOf(' (', percentIdx);
  if (confOpen < 0) return null;
  const confStr = trimmed.slice(confOpen + 2, percentIdx);
  const conf = Number.parseInt(confStr, 10);
  if (!Number.isFinite(conf) || String(conf) !== confStr) return null;

  const prefix = parseFileLinePrefix(trimmed, confOpen);
  if (!prefix) return null;
  const body = trimmed.slice(prefix.bodyStart, confOpen).trim();
  if (body.length === 0) return null;

  return { file: prefix.file, line: prefix.line, body, conf };
}

// Find the first `:` followed by digits + `:` — that locates the file/line split.
// File paths can contain colons (e.g. Windows drive letters), so we scan instead
// of taking the first colon.
function findVultureFileEnd(line, upperBound) {
  let start = 0;
  while (start < upperBound) {
    const colon = line.indexOf(':', start);
    if (colon < 0 || colon >= upperBound) return -1;
    let i = colon + 1;
    while (i < upperBound && isAsciiDigit(line.charCodeAt(i))) i++;
    if (i > colon + 1 && line.charCodeAt(i) === 58 /* ':' */) {
      return colon;
    }
    start = colon + 1;
  }
  return -1;
}

function isAsciiDigit(code) {
  return code >= 48 && code <= 57;
}

// Parse a vulture syntax-error line from stderr:
//   <file>:<line>: <message>
function parseVultureErrorLine(line) {
  const trimmed = line.trimEnd();
  if (trimmed.length === 0) return null;
  const prefix = parseFileLinePrefix(trimmed, trimmed.length);
  if (!prefix) return null;
  const message = trimmed.slice(prefix.bodyStart).trim();
  if (message.length === 0) return null;
  return { file: prefix.file, line: prefix.line, message };
}

export default {
  name: 'vulture',
  extensions: ['.py', '.pyi'],
  installHint: 'pipx install vulture  (or: pip3 install --user vulture)',

  buildCommand(targetDir, configPath, { files = [] } = {}) {
    const args = ['--min-confidence', '80'];
    if (files.length > 0) {
      args.push(...files);
    } else {
      args.push(targetDir);
    }
    return { bin: 'vulture', args, cwd: targetDir };
  },

  parseOutput(stdout, stderr, exitCode) {
    // vulture exits: 0 = clean, 1 = findings, 3 = parser error in target source, 2/>=4 = CLI/usage error.
    const findings = [];

    if (exitCode === 3) {
      for (const rawLine of (stderr || '').split('\n')) {
        const p = parseVultureErrorLine(rawLine);
        if (!p) continue;
        findings.push({
          file: p.file,
          line: p.line,
          col: undefined,
          tag: 'LINTER',
          rule: 'parse-error',
          severity: 'error',
          message: p.message,
        });
      }
      // If we couldn't extract any structured parse errors, fall back to
      // throwing so genuine misconfig isn't swallowed silently.
      if (findings.length === 0) {
        throw new Error(`vulture error (exit ${exitCode}): ${stderr.slice(0, 500)}`);
      }
    } else if (exitCode >= 2) {
      throw new Error(`vulture error (exit ${exitCode}): ${stderr.slice(0, 500)}`);
    }

    if (!stdout.trim()) return findings;

    for (const rawLine of stdout.split('\n')) {
      const p = parseVultureLine(rawLine);
      if (!p) continue;
      findings.push({
        file: p.file,
        line: p.line,
        col: undefined,
        tag: 'DEAD_CODE',
        rule: 'vulture/unused',
        severity: 'warning',
        message: `${p.body} (${p.conf}% confidence)`,
      });
    }
    return findings;
  },

  async checkInstalled() {
    try {
      await execFileAsync('vulture', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
