import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ignore from 'ignore';

// The omit filter can throw on malformed gitignore patterns; losing the
// filter beats aborting the scan.
function isOmitted(omitFilter, file) {
  if (!omitFilter) return false;
  try {
    return omitFilter.ignores(file);
  } catch {
    return false;
  }
}

// Unreadable files are skipped silently — line-length check has nothing
// to say about a file it cannot read.
async function readUtf8(path) {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

function lineFinding(file, lineCount, maxLines) {
  return {
    file,
    line: lineCount,
    col: undefined,
    tag: 'REFACTOR',
    rule: 'max-lines',
    severity: 'warning',
    message: `File has ${lineCount} lines (limit: ${maxLines}). Consider splitting into smaller modules.`,
  };
}

export async function checkFileLines(files, targetDir, { maxLines = 600, omitPatterns = [] } = {}) {
  const start = performance.now();

  if (maxLines <= 0) {
    return { tool: 'line-check', findings: [], error: null, duration: performance.now() - start };
  }

  const omitFilter = omitPatterns.length > 0 ? ignore().add(omitPatterns) : null;
  const findings = [];

  for (const file of files) {
    if (isOmitted(omitFilter, file)) continue;

    const content = await readUtf8(join(targetDir, file));
    if (content === null) continue;

    // split('\n') yields a trailing '' for the final newline — that empty
    // entry is not an extra line (and CRLF files keep their \r, harmless here).
    const lines = content.split('\n');
    if (lines.length > 1 && lines.at(-1) === '') lines.pop();
    if (lines.length > maxLines) {
      findings.push(lineFinding(file, lines.length, maxLines));
    }
  }

  return { tool: 'line-check', findings, error: null, duration: performance.now() - start };
}
