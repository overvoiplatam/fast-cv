import { relative, isAbsolute } from 'node:path';

const TAG_LEVEL = {
  SECURITY: 'error',
  BUG: 'error',
  PRIVACY: 'error',
  SECRET: 'error',
  LICENSE: 'error',
  REFACTOR: 'warning',
  LINTER: 'warning',
  DEPENDENCY: 'warning',
  INFRA: 'warning',
  TYPE_ERROR: 'warning',
  DOCS: 'warning',
  TYPO: 'warning',
  DEAD_CODE: 'warning',
  FORMAT: 'note',
  DUPLICATION: 'note',
};

export function formatSarif({ targetDir, results, warnings = [], fix = false }) {
  const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0);

  const toolBreakdown = results
    .filter(r => !r.error)
    .map(r => ({ tool: r.tool, duration: r.duration || 0, findings: (r.findings || []).length }));

  // Collect all findings with normalized paths
  const allFindings = [];
  for (const result of results) {
    if (result.error || !result.findings) continue;
    for (const f of result.findings) {
      const file = isAbsolute(f.file) ? relative(targetDir, f.file) : f.file;
      allFindings.push({ ...f, file, sourceTool: result.tool });
    }
  }

  // Build rules (deduplicated by ruleId)
  const ruleMap = new Map();
  for (const f of allFindings) {
    if (!ruleMap.has(f.rule)) {
      ruleMap.set(f.rule, {
        id: f.rule,
        shortDescription: { text: f.rule },
        defaultConfiguration: { level: TAG_LEVEL[f.tag] || 'warning' },
      });
    }
  }
  const rules = [...ruleMap.values()];
  const ruleIndex = new Map(rules.map((r, i) => [r.id, i]));

  // Build results
  const sarifResults = allFindings.map(f => ({
    ruleId: f.rule,
    ruleIndex: ruleIndex.get(f.rule),
    level: TAG_LEVEL[f.tag] || 'warning',
    message: { text: f.message },
    locations: [{
      physicalLocation: {
        artifactLocation: {
          uri: f.file.replace(/\\/g, '/'),
          uriBaseId: '%SRCROOT%',
        },
        region: {
          startLine: f.line || 1,
          ...(f.col != null ? { startColumn: f.col } : {}),
        },
      },
    }],
    properties: {
      sourceTool: f.sourceTool,
      tag: f.tag,
    },
  }));

  const runProperties = {
    targetDir,
    totalDuration,
    toolBreakdown,
  };
  if (warnings.length > 0) runProperties.warnings = warnings;
  if (fix) runProperties.fixMode = true;

  const sarif = {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'fast-cv',
          version: '0.2.0',
          informationUri: 'https://github.com/user/fast-cv',
          rules,
        },
      },
      columnKind: 'utf16CodeUnits',
      results: sarifResults,
      properties: runProperties,
    }],
  };

  return JSON.stringify(sarif, null, 2) + '\n';
}
