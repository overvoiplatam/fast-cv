import { collectFindings } from './findings.js';
import { cleanToolError } from './tool-errors.js';

/**
 * Compact, stable JSON report for agent/AI consumption.
 *
 * Shape is deliberately minimal and key-stable: consumers parse it, so keys
 * are never emitted with an `undefined` value (JSON.stringify drops them, and
 * `col` is only attached when the tool actually reported a column).
 *
 * @param {{targetDir: string, results: object[], warnings?: string[],
 *          fileCount?: number, minSeverity?: string}} input
 * @returns {string} pretty-printed JSON ending in a newline
 */
export function formatJsonReport({ targetDir, results, warnings = [], fileCount = 0, minSeverity } = {}) {
  const toolErrors = results.filter(r => r.error);
  const allFindings = collectFindings(results, targetDir, { includeSourceTool: true });

  const summary = {
    files: fileCount,
    tools: results.map(r => ({
      name: r.tool,
      // Errored tools contribute no findings to the report, so the per-tool
      // counts sum to summary.findings.
      findings: r.error ? 0 : (r.findings || []).length,
      error: Boolean(r.error),
    })),
    findings: allFindings.length,
    errors: toolErrors.length,
  };
  // Only emitted while the filter is active, so the default run stays stable.
  if (minSeverity && minSeverity !== 'warning') summary.minSeverity = minSeverity;

  const report = {
    target: targetDir,
    summary,
    findings: allFindings.map(toJsonFinding),
    toolErrors: toolErrors.map(r => {
      const entry = { tool: r.tool, error: cleanToolError(r.error) };
      if (r.hint) entry.hint = r.hint;
      return entry;
    }),
    warnings: [...warnings],
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}

function toJsonFinding(f) {
  const entry = {
    tool: f.sourceTool,
    file: f.file,
    line: f.line,
  };
  if (f.col !== undefined) entry.col = f.col;
  entry.tag = f.tag;
  entry.rule = f.rule;
  entry.severity = f.severity;
  entry.message = f.message;
  return entry;
}
