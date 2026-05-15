import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Manual parse of `tsc --noEmit --pretty false` output:
//   <file>(<line>,<col>): <severity> <TS####>: <message>
// Implemented with indexOf + slice rather than a regex with a `(.+?)`
// lazy quantifier so we don't need to suppress sonarjs/slow-regex.
function parseTscLine(line) {
  const sev = locateTscSeverity(line);
  if (!sev) return null;
  if (line.charCodeAt(sev.start - 1) !== 41 /* ')' */) return null;
  const openParen = line.lastIndexOf('(', sev.start);
  if (openParen < 0) return null;
  const file = line.slice(0, openParen);
  if (file.length === 0) return null;

  const pos = line.slice(openParen + 1, sev.start - 1);
  const comma = pos.indexOf(',');
  if (comma < 0) return null;
  const lineNum = Number.parseInt(pos.slice(0, comma), 10);
  const colNum = Number.parseInt(pos.slice(comma + 1), 10);
  if (!Number.isFinite(lineNum) || !Number.isFinite(colNum)) return null;

  const ruleStart = sev.end;
  const ruleColon = line.indexOf(':', ruleStart);
  if (ruleColon < 0) return null;
  const rule = line.slice(ruleStart, ruleColon);
  if (!isTscRuleId(rule)) return null;
  const message = line.slice(ruleColon + 1).trimStart();
  if (message.length === 0) return null;

  return { file, line: lineNum, col: colNum, severity: sev.severity, rule, message };
}

function locateTscSeverity(line) {
  const ERROR_SEP = '): error ';
  const WARN_SEP = '): warning ';
  const errIdx = line.indexOf(ERROR_SEP);
  const warnIdx = line.indexOf(WARN_SEP);
  if (errIdx >= 0 && (warnIdx < 0 || errIdx < warnIdx)) {
    return { start: errIdx + 1, end: errIdx + ERROR_SEP.length, severity: 'error' };
  }
  if (warnIdx >= 0) {
    return { start: warnIdx + 1, end: warnIdx + WARN_SEP.length, severity: 'warning' };
  }
  return null;
}

function isTscRuleId(s) {
  if (s.length < 3 || s.charCodeAt(0) !== 84 /* 'T' */ || s.charCodeAt(1) !== 83 /* 'S' */) return false;
  for (let i = 2; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

export default {
  name: 'tsc',
  extensions: ['.ts', '.tsx', '.mts', '.cts'],
  installHint: 'npm install -g typescript',

  buildCommand(targetDir, configPath) {
    const args = ['--noEmit', '--pretty', 'false'];
    args.push('--project', configPath || targetDir);
    return { bin: 'tsc', args };
  },

  parseOutput(stdout, stderr, exitCode) {
    if (exitCode >= 3) {
      throw new Error(`tsc error (exit ${exitCode}): ${(stderr || stdout).slice(0, 500)}`);
    }

    if (!stdout.trim()) return [];

    const findings = [];
    for (const rawLine of stdout.split('\n')) {
      const parsed = parseTscLine(rawLine);
      if (!parsed) continue;
      findings.push({
        file: parsed.file,
        line: parsed.line,
        col: parsed.col,
        tag: 'TYPE_ERROR',
        rule: parsed.rule,
        severity: parsed.severity,
        message: parsed.message,
      });
    }
    return findings;
  },

  async checkInstalled() {
    try {
      await execFileAsync('tsc', ['--version']);
      return true;
    } catch {
      return false;
    }
  },
};
