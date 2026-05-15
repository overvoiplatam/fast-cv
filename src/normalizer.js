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

export function formatReport({ targetDir, results, warnings = [], fix = false, fileCount = 0 }) {
  const toolErrors = results.filter(r => r.error);
  const allFindings = collectFindings(results, targetDir);

  const sections = [
    renderHeader({ targetDir, results, fileCount, fix }),
    renderBody({ allFindings, toolErrors, warnings }),
    renderFooter({ results, toolErrors, allFindings, fileCount }),
  ];
  return sections.join('\n');
}

function renderHeader({ targetDir, results, fileCount, fix }) {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const toolSummaries = results
    .filter(r => !r.error)
    .map(formatToolSummary);

  const lines = ['# fast-cv report', '', `**Target**: \`${targetDir}\``, `**Date**: ${now}`];
  if (fileCount > 0) lines.push(`**Files**: ${fileCount}`);
  if (toolSummaries.length > 0) lines.push(`**Tools**: ${toolSummaries.join(', ')}`);
  if (fix) lines.push('**Mode**: fix');
  lines.push('', '---', '');
  return lines.join('\n');
}

function renderBody({ allFindings, toolErrors, warnings }) {
  if (allFindings.length === 0 && warnings.length === 0 && toolErrors.length === 0) {
    return ['## No issues found', '', 'All checks passed.', ''].join('\n');
  }
  const parts = [];
  if (allFindings.length > 0) parts.push(renderFindingsSection(allFindings));
  if (toolErrors.length > 0) {
    if (parts.length > 0) parts.push('---\n');
    parts.push(renderToolErrorsSection(toolErrors));
  }
  if (warnings.length > 0) {
    if (parts.length > 0) parts.push('---\n');
    parts.push(renderWarningsSection(warnings));
  }
  return parts.join('\n');
}

function renderFindingsSection(allFindings) {
  const lines = [`## Findings (${pluralize(allFindings.length, 'issue')})`, ''];
  const byFile = groupFindingsByFile(allFindings);
  const sortedFiles = [...byFile.keys()].sort();
  for (const file of sortedFiles) {
    lines.push(`### \`${file}\``, '');
    const fileFindings = byFile.get(file).slice().sort((a, b) => (a.line || 0) - (b.line || 0));
    for (const f of fileFindings) {
      lines.push(`- **[${f.tag}]** \`${f.rule}\` ${f.message} (${formatLocation(f)})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderToolErrorsSection(toolErrors) {
  const lines = [`## Tool Errors (${toolErrors.length})`, ''];
  for (const r of toolErrors) {
    const duration = r.duration != null ? ` (${(r.duration / 1000).toFixed(1)}s)` : '';
    lines.push(`- **[ERROR]** \`${r.tool}\` ${r.error}${duration}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderWarningsSection(warnings) {
  const lines = ['## Warnings', ''];
  for (const w of warnings) {
    lines.push(`- **[WARN]** ${w}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderFooter({ results, toolErrors, allFindings, fileCount }) {
  const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0);
  const toolCount = results.filter(r => !r.error).length;
  const findingsPart = pluralize(allFindings.length, 'finding');
  const toolPart = pluralize(toolCount, 'completed tool');
  const filePart = fileCount > 0 ? ` across ${pluralize(fileCount, 'file')}` : '';
  const errorPart = toolErrors.length > 0 ? `; ${pluralize(toolErrors.length, 'tool error')}` : '';
  const durationPart = `${(totalDuration / 1000).toFixed(1)}s`;
  return ['---', '', `*${findingsPart} from ${toolPart}${filePart} in ${durationPart}${errorPart}*`, ''].join('\n');
}

function formatToolSummary(r) {
  if (r.duration == null) return r.tool;
  return `${r.tool} (${(r.duration / 1000).toFixed(1)}s)`;
}

function groupFindingsByFile(findings) {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  return byFile;
}

function formatLocation(f) {
  return f.col ? `line ${f.line}, col ${f.col}` : `line ${f.line}`;
}

function pluralize(n, noun) {
  return `${n} ${noun}${n !== 1 ? 's' : ''}`;
}
