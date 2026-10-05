// Shared pure helpers for tool adapters. Each one exists because a class of
// tools needs it and the behavior is small enough to standardize instead of
// duplicating per adapter. Everything here is pure over its arguments except
// skipUnlessFileExists, which owns single statSync call.

import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ─── Tool-reported path recovery ─────────────────────────────────────────
// Some tools relativize their findings' filenames against a base of their
// own choosing (golangci-lint v2 has been observed emitting paths relative
// to /tmp while its spawn cwd was the scanned project, and relative to the
// CLI process cwd on other setups). A path that does not resolve inside the
// target breaks the ignore() contract with `path should be a
// path.relative()d string`. Recovery walks the plausible bases — the target
// directory, its ancestor chain, tmpdir and the CLI cwd — and keeps the
// first candidate that exists on disk; absolute paths pass through
// untouched.
export function resolveReportedPath(filename, { targetDir, cwd = process.cwd(), tmpBase } = {}) {
  if (!filename || typeof filename !== 'string') return filename;
  // Absolute paths are already the tool's full statement.
  if (filename.startsWith('/')) return filename;

  const bases = [];
  let base = targetDir;
  while (base && base !== dirname(base)) {
    bases.push(base);
    base = dirname(base);
  }
  if (tmpBase) bases.push(tmpBase);
  bases.push(cwd);

  for (const candidateBase of bases) {
    const candidate = join(candidateBase, filename);
    try {
      statSync(candidate);
      return candidate;
    } catch {
      // next base
    }
  }
  return filename;
}

// ─── Leading-JSON extraction ───────────────────────────────────────────────
// Some tools print a JSON document and then human text: golangci-lint v2
// appends a summary line ("0 issues.") after the document, and other tools
// may prefix status text before it. Parses the first balanced JSON object
// wherever it sits in the output and returns it.
//
// Character access uses charAt() rather than bracket indexing with a
// variable — bracket access trips eslint-plugin-security's
// detect-object-injection rule on a plain scanner (this is the established
// convention in this codebase, see config-resolver.js).
//
// Scans from `start` for the index just past the balanced closing brace of
// the object that opens at `start`, or -1 when it never closes before EOF.
// String/escape aware so braces inside quoted values don't confuse depth.
function findBalancedEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// Throws when no parseable object is found; callers wrap the error with
// their own tool-specific message.
export function parseLeadingJson(text) {
  if (typeof text !== 'string') throw new Error('input is not a string');

  let start = text.indexOf('{');
  while (start !== -1) {
    const end = findBalancedEnd(text, start);
    if (end !== -1) {
      try {
        return JSON.parse(text.slice(start, end));
      } catch {
        // Not a JSON object after all — continue scanning from the next
        // opening brace: a non-JSON candidate's braces count as balanced
        // text (e.g. a status line "step {1 of 3}") and must not win.
      }
    }
    start = text.indexOf('{', start + 1);
  }

  throw new Error(`no parseable JSON object found in: ${text.slice(0, 200)}`);
}

// ─── Version-string major detection ───────────────────────────────────────
// Adapters behave differently per major of the external tool (flag changes,
// output shapes). Returns the first dotted major found anywhere in the
// version line — "golangci-lint has version 2.10.1 built with go1.26.0" → 2,
// "v10.12.0" → 10 — or null when no dotted version is present, so each
// adapter owns its fallback semantics.
export function majorFromVersion(versionText) {
  const match = /(^|[^\d])(\d+)\.\d+/.exec(String(versionText ?? ''));
  return match ? Number(match[2]) : null;
}

// ─── Project-root skip gates ──────────────────────────────────────────────
// Builds the `skip` hook an adapter exports (see runner.js): returns null
// when the file exists so the tool runs, or a short human note when it does
// not. The note travels into the report's [WARN] section — a tool that
// cannot bootstrap is reported, never silently un-run.
export function skipUnlessFileExists(file, note) {
  function skip({ targetDir }) {
    try {
      statSync(join(targetDir, file));
      return null;
    } catch {
      return note ?? `${file} not found in target — skipped`;
    }
  }

  return skip;
}
