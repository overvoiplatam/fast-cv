import { relative, isAbsolute } from 'node:path';

export function collectFindings(results, targetDir, { includeSourceTool = false } = {}) {
  const allFindings = [];
  for (const result of results) {
    if (result.error || !result.findings) continue;
    for (const f of result.findings) {
      const file = isAbsolute(f.file) ? relative(targetDir, f.file) : f.file;
      const entry = { ...f, file };
      if (includeSourceTool) entry.sourceTool = result.tool;
      allFindings.push(entry);
    }
  }
  return allFindings;
}
