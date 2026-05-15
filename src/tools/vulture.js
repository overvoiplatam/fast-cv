import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Manual parse of vulture stdout:
//   <file>:<line>: <body> (<conf>% confidence)
// indexOf/slice avoids the `(.+?)` lazy quantifier that trips sonarjs/slow-regex.
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

  // Prefix `<file>:<line>: ` — find the `:<digits>:` pair from the left.
  const fileEnd = findVultureFileEnd(trimmed, confOpen);
  if (fileEnd < 0) return null;
  const lineNumEnd = trimmed.indexOf(':', fileEnd + 1);
  if (lineNumEnd < 0) return null;
  const lineStr = trimmed.slice(fileEnd + 1, lineNumEnd);
  const lineNum = Number.parseInt(lineStr, 10);
  if (!Number.isFinite(lineNum) || String(lineNum) !== lineStr) return null;

  const file = trimmed.slice(0, fileEnd);
  if (file.length === 0) return null;
  const body = trimmed.slice(lineNumEnd + 1, confOpen).trim();
  if (body.length === 0) return null;

  return { file, line: lineNum, body, conf };
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
    // vulture exits: 0 = clean, 1 = findings, 2+ = error
    if (exitCode >= 2) {
      throw new Error(`vulture error (exit ${exitCode}): ${stderr.slice(0, 500)}`);
    }

    if (!stdout.trim()) return [];

    const findings = [];
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
