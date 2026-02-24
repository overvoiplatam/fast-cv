import { relative, isAbsolute } from 'node:path';

export function filterFindings(results, targetDir, ignoreFilter, onlyFilter) {
  return results.map(result => {
    if (result.error || !result.findings || result.findings.length === 0) return result;

    const filtered = result.findings.filter(f => {
      const relPath = isAbsolute(f.file) ? relative(targetDir, f.file) : f.file;
      if (ignoreFilter.ignores(relPath)) return false;
      // If --only is active, strip findings outside the inclusion set
      if (onlyFilter && !onlyFilter.includes(relPath)) return false;
      return true;
    });

    return { ...result, findings: filtered };
  });
}

export function formatReport({ targetDir, results, warnings = [], fix = false }) {
  const lines = [];
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  // Collect tool timings
  const toolSummaries = results
    .filter(r => !r.error)
    .map(r => `${r.tool}${r.duration != null ? ` (${(r.duration / 1000).toFixed(1)}s)` : ''}`);

  const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0);

  // Header
  lines.push('# fast-cv report');
  lines.push('');
  lines.push(`**Target**: \`${targetDir}\``);
  lines.push(`**Date**: ${now}`);
  if (toolSummaries.length > 0) {
    lines.push(`**Tools**: ${toolSummaries.join(', ')}`);
  }
  if (fix) {
    lines.push('**Mode**: fix');
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Collect all findings, normalizing file paths to be relative
  const allFindings = [];
  for (const result of results) {
    if (result.error || !result.findings) continue;
    for (const f of result.findings) {
      const file = isAbsolute(f.file) ? relative(targetDir, f.file) : f.file;
      allFindings.push({ ...f, file });
    }
  }

  if (allFindings.length === 0 && warnings.length === 0) {
    lines.push('## No issues found');
    lines.push('');
    lines.push('All checks passed.');
    lines.push('');
  } else {
    // Group findings by file
    if (allFindings.length > 0) {
      lines.push(`## Findings (${allFindings.length} issue${allFindings.length !== 1 ? 's' : ''})`);
      lines.push('');

      const byFile = new Map();
      for (const f of allFindings) {
        if (!byFile.has(f.file)) byFile.set(f.file, []);
        byFile.get(f.file).push(f);
      }

      // Sort files alphabetically
      const sortedFiles = [...byFile.keys()].sort();
      for (const file of sortedFiles) {
        lines.push(`### \`${file}\``);
        lines.push('');
        const fileFindings = byFile.get(file);
        // Sort by line number
        fileFindings.sort((a, b) => (a.line || 0) - (b.line || 0));
        for (const f of fileFindings) {
          const location = f.col ? `line ${f.line}, col ${f.col}` : `line ${f.line}`;
          lines.push(`- **[${f.tag}]** \`${f.rule}\` ${f.message} (${location})`);
        }
        lines.push('');
      }
    }

    // Warnings section
    if (warnings.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## Warnings');
      lines.push('');
      for (const w of warnings) {
        lines.push(`- **[WARN]** ${w}`);
      }
      lines.push('');
    }
  }

  // Footer
  lines.push('---');
  lines.push('');
  const toolCount = results.filter(r => !r.error).length;
  lines.push(`*${allFindings.length} finding${allFindings.length !== 1 ? 's' : ''} from ${toolCount} tool${toolCount !== 1 ? 's' : ''} in ${(totalDuration / 1000).toFixed(1)}s*`);
  lines.push('');

  return lines.join('\n');
}
