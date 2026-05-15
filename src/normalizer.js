import { relative, isAbsolute } from 'node:path';
import { collectFindings } from './findings.js';

export function filterFindings(results, targetDir, ignoreFilter, onlyFilter, { verbose = false } = {}) {
  return results.map(result => {
    if (result.error || !result.findings || result.findings.length === 0) return result;

    const before = result.findings.length;
    const filtered = result.findings.filter(f => {
      const relPath = isAbsolute(f.file) ? relative(targetDir, f.file) : f.file;
      if (ignoreFilter.ignores(relPath)) return false;
      // If --only is active, strip findings outside the inclusion set
      if (onlyFilter && !onlyFilter.includes(relPath)) return false;
      // For cross-file tools (jscpd): also filter if the paired file is ignored
      if (f.otherFile) {
        const otherRel = isAbsolute(f.otherFile) ? relative(targetDir, f.otherFile) : f.otherFile;
        if (ignoreFilter.ignores(otherRel)) return false;
      }
      return true;
    });

    if (verbose && filtered.length < before) {
      process.stderr.write(`  ${result.tool}: ${before} found → ${filtered.length} after filter (${before - filtered.length} ignored)\n`);
      // Show sample filtered paths for debugging
      const dropped = result.findings.filter(f => !filtered.includes(f));
      const samples = dropped.slice(0, 3).map(f => {
        const rel = isAbsolute(f.file) ? relative(targetDir, f.file) : f.file;
        return `    - ${rel}`;
      });
      if (samples.length > 0) {
        process.stderr.write(samples.join('\n') + '\n');
      }
    }

    return { ...result, findings: filtered };
  });
}

// eslint-disable-next-line complexity, sonarjs/cognitive-complexity -- markdown formatter walks all finding tags + tool-error + warning sections in one pass
export function formatReport({ targetDir, results, warnings = [], fix = false, fileCount = 0 }) {
  const lines = [];
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const toolErrors = results.filter(r => r.error);

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
  if (fileCount > 0) {
    lines.push(`**Files**: ${fileCount}`);
  }
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
  const allFindings = collectFindings(results, targetDir);

  if (allFindings.length === 0 && warnings.length === 0 && toolErrors.length === 0) {
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

    if (toolErrors.length > 0) {
      if (allFindings.length > 0) {
        lines.push('---');
        lines.push('');
      }
      lines.push(`## Tool Errors (${toolErrors.length})`);
      lines.push('');
      for (const r of toolErrors) {
        const duration = r.duration != null ? ` (${(r.duration / 1000).toFixed(1)}s)` : '';
        lines.push(`- **[ERROR]** \`${r.tool}\` ${r.error}${duration}`);
      }
      lines.push('');
    }

    // Warnings section
    if (warnings.length > 0) {
      if (allFindings.length > 0 || toolErrors.length > 0) {
        lines.push('---');
        lines.push('');
      }
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
  const filePart = fileCount > 0 ? ` across ${fileCount} file${fileCount !== 1 ? 's' : ''}` : '';
  const errorPart = toolErrors.length > 0 ? `; ${toolErrors.length} tool error${toolErrors.length !== 1 ? 's' : ''}` : '';
  lines.push(`*${allFindings.length} finding${allFindings.length !== 1 ? 's' : ''} from ${toolCount} completed tool${toolCount !== 1 ? 's' : ''}${filePart} in ${(totalDuration / 1000).toFixed(1)}s${errorPart}*`);
  lines.push('');

  return lines.join('\n');
}
