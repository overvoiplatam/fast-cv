// A tool that fails is reported differently from a finding: there is no file
// or line to point at, only a message the tool printed on its way out. Those
// messages arrive as raw stderr — often a multi-line stack trace — and on their
// own they say nothing about what to do next. This module turns them into one
// readable line plus, where the cause is recognizable, a remediation.

const STACK_FRAME = /^\s*at\s/;
const MAX_ERROR_LENGTH = 300;

/**
 * Collapses a tool's raw error output to a single readable line: stack frames
 * dropped, whitespace normalized, length capped.
 */
export function cleanToolError(message) {
  if (!message) return 'failed with no diagnostic output';

  const lines = message
    .split('\n')
    .filter(line => !STACK_FRAME.test(line))
    .map(line => line.trim())
    .filter(Boolean);

  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (!text) return 'failed with no diagnostic output';
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}…` : text;
}

// Recognizable failure shapes, most specific first. Each maps a message to the
// one action that resolves it. Anything unmatched gets no hint rather than a
// guess — a wrong instruction is worse than none.
// Kept as separate simple patterns rather than one combined expression: the
// database and the failure word can appear in either order, and spelling that
// as a single regex costs more in complexity than it saves.
const DB_SUBJECT = /\bdb\b|database/i;
const DB_PROBLEM = /download|update|stale|expired|missing/i;

const HINT_RULES = [
  {
    // stylelint/eslint configs `extend` packages that live in fast-cv's own
    // node_modules; a partial install leaves them missing.
    matches: msg => /could not find ["']?[\w@/-]+/i.test(msg) || /cannot find module/i.test(msg),
    hint: 'A package the shipped config depends on is missing. Reinstall it with '
      + '`install.sh --repair` from your fast-cv install directory.',
  },
  {
    matches: msg => /command not found|ENOENT|not recognized as/i.test(msg),
    useInstallHint: true,
  },
  {
    matches: msg => /permission denied|EACCES/i.test(msg),
    hint: 'fast-cv could not read or execute something it needs. Check the permissions '
      + 'on the target directory and on the tool binary.',
  },
  {
    matches: msg => DB_SUBJECT.test(msg) && DB_PROBLEM.test(msg),
    hint: 'Refresh the vulnerability databases with `fast-cv --update-db .`.',
  },
];

/**
 * Best-effort remediation for a failed tool. Returns null when the cause is not
 * recognized, so the report stays silent rather than guessing.
 */
export function inferToolErrorHint(message, installHint) {
  if (!message) return null;

  for (const rule of HINT_RULES) {
    if (!rule.matches(message)) continue;
    if (rule.useInstallHint) {
      return installHint ? `Install the tool: ${installHint}` : null;
    }
    return rule.hint;
  }
  return null;
}
