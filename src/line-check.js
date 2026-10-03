import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ignore from 'ignore';

export async function checkFileLines(files, targetDir, { maxLines = 600, omitPatterns = [] } = {}) {
  const start = performance.now();

  if (maxLines <= 0) {
    return { tool: 'line-check', findings: [], error: null, duration: performance.now() - start };
  }

  const omitFilter = omitPatterns.length > 0 ? ignore().add(omitPatterns) : null;
  const findings = [];

  for (const file of files) {
    if (omitFilter) {
      try { if (omitFilter.ignores(file)) continue; } catch { /* skip filter errors */ }
    }

    let content;
    try {
      content = await readFile(join(targetDir, file), 'utf-8');
    } catch {
      continue;
    }

    // split('\n') yields a trailing '' for the final newline — that empty
    // entry is not an extra line (and CRLF files keep their \r, harmless here).
    const lines = content.split('\n');
    if (lines.length > 1 && lines.at(-1) === '') lines.pop();
    const lineCount = lines.length;
    if (lineCount > maxLines) {
      findings.push({
        file,
        line: lineCount,
        col: undefined,
        tag: 'REFACTOR',
        rule: 'max-lines',
        severity: 'warning',
        message: `File has ${lineCount} lines (limit: ${maxLines}). Consider splitting into smaller modules.`,
      });
    }
  }

  return { tool: 'line-check', findings, error: null, duration: performance.now() - start };
}
