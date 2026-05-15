import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Manual parse of markdownlint-cli2 stdout:
//   <file>:<line>[:<col>] <MDxxx[/alias]> <message>
// indexOf/slice avoids the `(.+?)` lazy quantifier (sonarjs/slow-regex)
// and the alternation inside `(MD\d+(?:/[\w-]+)*)` that triggered
// detect-unsafe-regex.
function parseMarkdownlintLine(line) {
  // Find the rule token (starts with "MD" + digits) preceded by whitespace.
  const ruleStart = locateMarkdownlintRuleStart(line);
  if (ruleStart < 0) return null;
  const ruleEnd = locateRuleEnd(line, ruleStart);
  if (ruleEnd < 0) return null;
  const rule = line.slice(ruleStart, ruleEnd);
  if (!isMarkdownlintRuleId(rule)) return null;

  const prefix = line.slice(0, ruleStart).trimEnd();
  const fileLineCol = parseFileLineCol(prefix);
  if (!fileLineCol) return null;

  const message = line.slice(ruleEnd).trimStart();
  if (message.length === 0) return null;

  return { ...fileLineCol, rule, message };
}

function locateMarkdownlintRuleStart(line) {
  let i = 0;
  while (i < line.length) {
    const sp = line.indexOf(' ', i);
    if (sp < 0) return -1;
    // Skip the space(s); inspect the next non-space token.
    let j = sp + 1;
    while (j < line.length && line.charCodeAt(j) === 32) j++;
    if (j + 2 <= line.length
        && line.charCodeAt(j) === 77 /* 'M' */
        && line.charCodeAt(j + 1) === 68 /* 'D' */
        && isAsciiDigit(line.charCodeAt(j + 2))) {
      return j;
    }
    i = sp + 1;
  }
  return -1;
}

function locateRuleEnd(line, start) {
  for (let i = start; i < line.length; i++) {
    if (line.charCodeAt(i) === 32 /* space */) return i;
  }
  return -1;
}

function isMarkdownlintRuleId(s) {
  if (s.length < 3 || s.charCodeAt(0) !== 77 || s.charCodeAt(1) !== 68) return false;
  let i = 2;
  while (i < s.length && isAsciiDigit(s.charCodeAt(i))) i++;
  if (i === 2) return false;  // need at least one digit after "MD"
  if (i === s.length) return true;
  // Optional `/alias[/alias…]` — each alias is [A-Za-z0-9_-]+
  while (i < s.length) {
    if (s.charCodeAt(i) !== 47 /* '/' */) return false;
    i++;
    const aliasStart = i;
    while (i < s.length && isAliasChar(s.charCodeAt(i))) i++;
    if (i === aliasStart) return false;
  }
  return true;
}

function isAliasChar(code) {
  return (code >= 48 && code <= 57)     // 0-9
    || (code >= 65 && code <= 90)       // A-Z
    || (code >= 97 && code <= 122)      // a-z
    || code === 95 /* _ */
    || code === 45 /* - */;
}

// Parse `<file>:<line>[:<col>]` from the prefix string. File paths can
// contain colons, so we scan from the right: pick the last `:<digits>` (col),
// then the next `:<digits>` (line), then everything before is the file.
function parseFileLineCol(prefix) {
  const last = locateRightmostColonNumber(prefix, prefix.length);
  if (!last) return null;
  // last.colonAt..end is `:NUMBER`. If there's another `:NUMBER` immediately
  // before, that earlier one is `line` and the later one is `col`.
  const prior = locateRightmostColonNumber(prefix, last.colonAt);
  if (prior) {
    return { file: prefix.slice(0, prior.colonAt), line: prior.value, col: last.value };
  }
  return { file: prefix.slice(0, last.colonAt), line: last.value, col: undefined };
}

function locateRightmostColonNumber(s, upperBound) {
  let i = upperBound - 1;
  while (i >= 0 && isAsciiDigit(s.charCodeAt(i))) i--;
  if (i === upperBound - 1) return null;   // no trailing digits
  if (i < 0 || s.charCodeAt(i) !== 58 /* ':' */) return null;
  const value = Number.parseInt(s.slice(i + 1, upperBound), 10);
  if (!Number.isFinite(value)) return null;
  return { colonAt: i, value };
}

function isAsciiDigit(code) {
  return code >= 48 && code <= 57;
}

const CLI_BIN = 'markdownlint-cli2';
const SKIP_LINE_PREFIXES = ['Finding:', 'Linting:', 'Summary:', CLI_BIN];

function shouldSkipLine(line) {
  for (const prefix of SKIP_LINE_PREFIXES) {
    if (line.startsWith(prefix)) return true;
  }
  return false;
}

export default {
  name: 'markdownlint',
  extensions: ['.md', '.markdown'],
  supportsFix: true,
  installHint: `npm install -g ${CLI_BIN}`,

  buildCommand(targetDir, configPath, { files = [], fix = false } = {}) {
    const args = [];
    if (configPath) args.push('--config', configPath);
    if (fix) args.push('--fix');
    const relevant = files.filter(f => /\.(md|markdown)$/i.test(f));
    if (relevant.length > 0) args.push(...relevant);
    else args.push('**/*.{md,markdown}');
    return { bin: CLI_BIN, args, cwd: targetDir };
  },

  parseOutput(stdout, stderr, exitCode) {
    if (exitCode > 1 && !stderr.trim() && !stdout.trim()) {
      throw new Error(`markdownlint error (exit ${exitCode})`);
    }
    const findings = [];
    const blob = `${stderr}\n${stdout}`;
    for (const rawLine of blob.split('\n')) {
      const line = rawLine.trim();
      if (!line || shouldSkipLine(line)) continue;
      const parsed = parseMarkdownlintLine(line);
      if (!parsed) continue;
      findings.push({
        file: parsed.file,
        line: parsed.line || 1,
        col: parsed.col,
        tag: 'DOCS',
        rule: `md/${parsed.rule}`,
        severity: 'warning',
        message: parsed.message,
      });
    }
    return findings;
  },

  async checkInstalled() {
    try {
      await execFileAsync(CLI_BIN, ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
