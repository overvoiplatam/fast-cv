import { Command, Option } from 'commander';
import { resolve } from 'node:path';
import { accessSync, constants, existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { pruneDirectory } from './pruner.js';
import { precheck } from './precheck.js';
import { resolveConfig } from './config-resolver.js';
import { runTools } from './runner.js';
import { formatReport, filterFindings, applyMinSeverity } from './normalizer.js';
import { formatSarif } from './sarif.js';
import { formatJsonReport } from './report-json.js';
import { tools as allTools } from './tools/index.js';
import { checkFileLines } from './line-check.js';
import { getGitChangedFiles } from './git-changes.js';
import { VERSION } from './version.js';

const EXIT_CLEAN = 0;
const EXIT_FINDINGS = 1;
const EXIT_PRECHECK_FAILED = 2;

export function getScanExitCode(results) {
  if (results.some(r => r.error)) return EXIT_PRECHECK_FAILED;
  if (results.some(r => r.findings && r.findings.length > 0)) return EXIT_FINDINGS;
  return EXIT_CLEAN;
}

export async function run(argv) {
  const program = new Command();
  configureScanCommand(program);
  configureInstallHookCommand(program);
  await program.parseAsync(argv);
}

function configureScanCommand(program) {
  program
    .name('fast-cv')
    .description('Fast Code Validation — sequential linters & security scanners with unified Markdown reports')
    .version(VERSION)
    .argument('[directory]', 'target directory to scan', '.')
    .option('-t, --timeout <seconds>', 'per-tool timeout in seconds (disabled by default)')
    .option('--tools <names>', 'comma-separated list of tools to run (default: all applicable)')
    .option('-v, --verbose', 'show detailed output on stderr', false)
    .option('--auto-install', 'automatically install missing tools', false)
    .option('-x, --exclude <patterns>', 'comma-separated ignore patterns (gitignore syntax)', '')
    .option('--only <patterns>', 'comma-separated file paths or glob patterns to scan exclusively', '')
    .option('--fix', 'auto-fix formatting/style issues where supported', false)
    .option('--licenses', 'include open-source license compliance scanning (trivy)', false)
    .option('--update-db', 'allow tools with external databases to refresh them before scanning (currently trivy)', false)
    .option('--sbom', 'generate CycloneDX SBOM inventory (requires trivy)', false)
    .option('--max-lines <number>', 'flag files exceeding this line count (0 to disable)', '600')
    .option('--max-lines-omit <patterns>', 'comma-separated patterns to exclude from line count check (gitignore syntax)', '')
    .option('--no-docstring', 'suppress documentation findings (DOCS tag)', false)
    .option('--git-only [scope]', 'scan only git-changed files (default: uncommitted+unpushed; use --git-only=uncommitted for uncommitted only)', false)
    .addOption(new Option('-f, --format <type>', 'output format').choices(['markdown', 'sarif', 'json']).default('markdown'))
    .addOption(new Option('--min-severity <level>', 'lowest severity to report (error: hide warnings)').choices(['error', 'warning']).default('warning'))
    .action(executeScanAction);
}

async function executeScanAction(directory, options) {
  const targetDir = resolve(directory);
  ensureReadable(targetDir);

  if (options.sbom) return runSbomFlow(targetDir, options);

  const parsed = parseScanOptions(options);
  const gitFiles = await resolveGitOnlyFiles(targetDir, options, parsed);
  if (gitFiles === EXIT_SENTINEL) return; // handled inside

  const pruneResult = await pruneOrExit(targetDir, parsed, gitFiles);
  if (pruneResult === EXIT_SENTINEL) return;
  const { files, languages, ignoreFilter, onlyFilter } = pruneResult;

  const applicableTools = selectApplicableTools(languages, options);
  if (applicableTools.length === 0) {
    exitForNoApplicableTools(parsed, targetDir);
    return;
  }

  const precheckResult = await precheck(applicableTools, {
    autoInstall: options.autoInstall, verbose: parsed.verbose,
  });
  if (!precheckResult.ok) {
    process.stderr.write(precheckResult.message);
    process.exit(EXIT_PRECHECK_FAILED);
  }

  if (parsed.fix) {
    await runFixOnlyFlow(precheckResult.tools, targetDir, parsed, files);
    return;
  }

  await runScanFlow(precheckResult, targetDir, parsed, { files, ignoreFilter, onlyFilter });
}

const EXIT_SENTINEL = Symbol('exit');

function ensureReadable(targetDir) {
  try {
    accessSync(targetDir, constants.R_OK);
  } catch {
    process.stderr.write(`Error: directory not found or not readable: ${targetDir}\n`);
    process.exit(EXIT_PRECHECK_FAILED);
  }
}

function parseScanOptions(options) {
  return {
    timeout: options.timeout == null ? 0 : parseInt(options.timeout, 10) * 1000,
    verbose: options.verbose,
    exclude: splitCsv(options.exclude),
    only: splitCsv(options.only),
    fix: options.fix,
    licenses: options.licenses,
    updateDb: options.updateDb,
    maxLines: parseMaxLines(options.maxLines),
    maxLinesOmit: splitCsv(options.maxLinesOmit),
    fmt: resolveFormatter(options.format),
    noDocstring: options.noDocstring,
    minSeverity: options.minSeverity || 'warning',
  };
}

// Each format has its own formatter; resolve it once instead of a nested ternary.
function resolveFormatter(format) {
  if (format === 'sarif') return formatSarif;
  if (format === 'json') return formatJsonReport;
  return formatReport;
}

// parseInt('abc') is NaN, which would silently disable the line check.
// The flag is always present (default '600'), so validate whatever value
// commander hands us; '0' remains the documented "disable" value.
function parseMaxLines(value) {
  if (!/^\d+$/.test(String(value))) {
    process.stderr.write(`Error: invalid --max-lines value: ${value} (expected a non-negative integer, 0 to disable)\n`);
    process.exit(EXIT_PRECHECK_FAILED);
  }
  return parseInt(value, 10);
}

function splitCsv(value) {
  if (!value) return [];
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

// Same failure style as parseMaxLines: a usage error should never pass
// silently, so known scopes map 1:1. Unknown strings keep the 0.2.1
// behavior — they were silently treated as the uncommitted scope, which is
// how the documented `--git-only .` pattern worked: commander folds the
// positional target token into the optional `[scope]` (e.g. `--git-only .`
// yields scope=".", target defaults to "."). Breaking that ember would
// change what production hooks and CI scripts scan, so we keep the mapping
// and emit a loud stderr warning instead.
// Exported for tests; each mapping is covered by a unit test.
export function parseGitOnlyScope(value) {
  if (value === true || value === 'all') return 'all';
  if (value !== 'uncommitted') {
    process.stderr.write(
      `Warning: --git-only "${String(value)}" is not a known scope; using the 0.2.1 default (uncommitted). `
      + `Say --git-only=all or --git-only=uncommitted to be explicit.\n`
    );
  }
  // 'uncommitted' and every unknown value map to 'uncommitted' (0.2.1 compat).
  return 'uncommitted';
}

async function resolveGitOnlyFiles(targetDir, options, parsed) {
  if (options.gitOnly === false) return null;
  const scope = parseGitOnlyScope(options.gitOnly);
  let gitFiles;
  try {
    gitFiles = await getGitChangedFiles(targetDir, scope);
  } catch (e) {
    process.stderr.write(`Error: ${e.message}\n`);
    process.exit(EXIT_PRECHECK_FAILED);
  }
  if (gitFiles.length === 0) {
    handleNoGitChanges(targetDir, parsed);
    return EXIT_SENTINEL;
  }
  if (parsed.verbose) process.stderr.write(`Git-changed files: ${gitFiles.length}\n`);
  return gitFiles;
}

function handleNoGitChanges(targetDir, parsed) {
  if (parsed.verbose) process.stderr.write('No git-changed files found.\n');
  if (parsed.fix) {
    process.stderr.write('Nothing to fix (clean working tree).\n');
    process.exit(EXIT_CLEAN);
  }
  process.stdout.write(parsed.fmt({
    targetDir,
    results: [],
    warnings: ['No git-changed files found (clean working tree).'],
    minSeverity: parsed.minSeverity,
  }));
  process.exit(EXIT_CLEAN);
}

async function pruneOrExit(targetDir, parsed, gitFiles) {
  if (parsed.verbose) process.stderr.write(`Scanning ${targetDir}...\n`);
  const result = await pruneDirectory(targetDir, {
    exclude: parsed.exclude, only: parsed.only, gitFiles,
  });
  if (parsed.verbose) {
    process.stderr.write(`Found ${result.files.length} files, languages: ${[...result.languages].join(', ')}\n`);
  }
  if (result.files.length === 0) {
    handleNoScannableFiles(targetDir, parsed);
    return EXIT_SENTINEL;
  }
  return result;
}

function handleNoScannableFiles(targetDir, parsed) {
  if (parsed.fix) {
    process.stderr.write('No fixable files found.\n');
    process.exit(EXIT_CLEAN);
  }
  process.stdout.write(parsed.fmt({
    targetDir, results: [],
    warnings: ['No scannable files found.'],
    minSeverity: parsed.minSeverity,
  }));
  process.exit(EXIT_CLEAN);
}

function selectApplicableTools(languages, options) {
  const requested = options.tools
    ? options.tools.split(',').map(s => s.trim().toLowerCase())
    : null;
  const byLang = allTools.filter(tool => isToolApplicable(tool, languages, requested));
  if (!requested) return byLang;
  return byLang.filter(t => requested.includes(t.name));
}

function isToolApplicable(tool, languages, requested) {
  const hasExtension = tool.extensions.some(ext => languages.has(ext));
  if (!hasExtension) return false;
  // Opt-in tools only run when explicitly requested via --tools.
  if (tool.optIn && (!requested || !requested.includes(tool.name))) return false;
  return true;
}

function exitForNoApplicableTools(parsed, targetDir) {
  if (parsed.fix) {
    process.stderr.write('No fix-capable tools found for detected languages.\n');
    process.exit(EXIT_CLEAN);
  }
  process.stdout.write(parsed.fmt({
    targetDir, results: [],
    warnings: ['No applicable tools for detected languages.'],
    minSeverity: parsed.minSeverity,
  }));
  process.exit(EXIT_CLEAN);
}

async function runFixOnlyFlow(readyTools, targetDir, parsed, files) {
  const fixTools = readyTools.filter(t => t.supportsFix);
  if (fixTools.length === 0) {
    process.stderr.write('No fix-capable tools found for detected languages.\n');
    process.exit(EXIT_CLEAN);
  }

  const fixConfigs = await resolveConfigsFor(fixTools, targetDir);
  if (parsed.verbose) process.stderr.write(`Fixing with ${fixTools.map(t => t.name).join(', ')}...\n`);
  const results = await runTools(fixConfigs, targetDir, {
    timeout: parsed.timeout, verbose: parsed.verbose, files,
    fix: true, updateDb: parsed.updateDb, exclude: parsed.exclude,
  });

  reportFixResults(results);
}

async function resolveConfigsFor(tools, targetDir) {
  return Promise.all(tools.map(async tool => ({
    tool,
    config: await resolveConfig(tool.name, targetDir),
  })));
}

function reportFixResults(results) {
  const warnings = results
    .filter(r => r.fixSkipped)
    .map(r => `${r.tool}: --fix limited to formatting (using shipped default config)`);
  const toolSummary = results.map(r => `${r.tool} (${(r.duration / 1000).toFixed(1)}s)`).join(', ');
  process.stderr.write(`Fixed with: ${toolSummary}\n`);
  for (const w of warnings) process.stderr.write(`  ${w}\n`);

  const errored = results.filter(r => r.error);
  if (errored.length > 0) {
    for (const r of errored) process.stderr.write(`  ${r.tool}: ${r.error}\n`);
    process.exit(EXIT_PRECHECK_FAILED);
  }
  process.exit(EXIT_CLEAN);
}

async function runScanFlow(precheckResult, targetDir, parsed, prune) {
  const readyTools = precheckResult.tools;
  const toolConfigs = await resolveConfigsFor(readyTools, targetDir);

  if (parsed.verbose) process.stderr.write(`Running ${readyTools.map(t => t.name).join(', ')}...\n`);
  const results = await runTools(toolConfigs, targetDir, {
    timeout: parsed.timeout, verbose: parsed.verbose, files: prune.files,
    licenses: parsed.licenses, updateDb: parsed.updateDb, exclude: parsed.exclude,
  });

  if (parsed.maxLines > 0) {
    const lineResult = await checkFileLines(prune.files, targetDir, {
      maxLines: parsed.maxLines, omitPatterns: parsed.maxLinesOmit,
    });
    results.push(lineResult);
  }

  const filtered = filterFindings(results, targetDir, prune.ignoreFilter, prune.onlyFilter, {
    verbose: parsed.verbose,
  });
  if (parsed.noDocstring) stripDocsFindings(filtered);
  // Last filter before the exit code and the report are computed, so both
  // agree on what a "finding" is once --min-severity is in play.
  applyMinSeverity(filtered, parsed.minSeverity);

  const warnings = [...(prune.warnings || []), ...(precheckResult.warnings || [])];
  process.stdout.write(parsed.fmt({
    targetDir, results: filtered, warnings, fileCount: prune.files.length,
    minSeverity: parsed.minSeverity,
  }));
  process.exit(getScanExitCode(filtered));
}

function stripDocsFindings(filtered) {
  for (const r of filtered) {
    if (r.findings) r.findings = r.findings.filter(f => f.tag !== 'DOCS');
  }
}

async function runSbomFlow(targetDir, options) {
  const trivyTool = allTools.find(t => t.name === 'trivy');
  const installed = trivyTool && await trivyTool.checkInstalled();
  if (!installed) {
    process.stderr.write(`Error: trivy is required for SBOM generation. ${trivyTool?.installHint || ''}\n`);
    process.exit(EXIT_PRECHECK_FAILED);
  }
  if (options.updateDb) {
    const config = await resolveConfig('trivy', targetDir);
    for (const cmd of trivyTool.updateDbCommands(targetDir, config.path)) {
      const { stderr, exitCode } = await spawnTrivy(cmd.args);
      if (exitCode !== 0) {
        const detail = stderr.slice(0, 500) || `exit code ${exitCode}`;
        process.stderr.write(`trivy DB update failed: ${detail}\n`);
        process.exit(EXIT_PRECHECK_FAILED);
      }
    }
  }
  const { stdout, stderr, exitCode } = await spawnSbom(targetDir);
  if (!stdout.trim() || exitCode !== 0) {
    const advice = needsDbUpdateAdvice(stderr)
      ? ' Run fast-cv with --update-db --sbom . to refresh the trivy databases before generating the SBOM.'
      : '';
    process.stderr.write(`trivy SBOM error: ${stderr.slice(0, 500)}${advice}\n`);
    process.exit(EXIT_PRECHECK_FAILED);
  }
  process.stdout.write(stdout);
  process.exit(EXIT_CLEAN);
}

function spawnSbom(targetDir) {
  return spawnTrivy([
    'fs',
    '--format', 'cyclonedx',
    '--quiet',
    '--offline-scan',
    '--skip-db-update',
    '--skip-java-db-update',
    '--skip-check-update',
    '--skip-vex-repo-update',
    targetDir,
  ]);
}

async function spawnTrivy(args) {
  const { spawn: spawnProc } = await import('node:child_process');
  const proc = spawnProc('trivy', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  proc.stdout.on('data', c => { stdout += c; });
  proc.stderr.on('data', c => { stderr += c; });
  const exitCode = await new Promise((r) => {
    proc.on('close', r);
    proc.on('error', (err) => { stderr += err.message; r(-1); });
  });
  return { stdout, stderr, exitCode };
}

function needsDbUpdateAdvice(stderr) {
  return /db|database|metadata|cache|download|update/i.test(stderr);
}

function configureInstallHookCommand(program) {
  program
    .command('install-hook')
    .description('Install git pre-commit hook that runs fast-cv before each commit')
    .argument('[directory]', 'project directory', '.')
    .option('--force', 'overwrite existing pre-commit hook', false)
    .action(async (directory, opts) => {
      const dir = resolve(directory);
      const gitDir = resolve(dir, '.git');

      if (!existsSync(gitDir)) {
        process.stderr.write(`Error: ${dir} is not a git repository (no .git directory found)\n`);
        process.exit(EXIT_PRECHECK_FAILED);
      }

      const hooksDir = resolve(gitDir, 'hooks');
      const hookPath = resolve(hooksDir, 'pre-commit');

      const hookScript = `#!/usr/bin/env bash
# [fast-cv] pre-commit hook — auto-generated by fast-cv install-hook
fast-cv .
exit_code=$?
if [ $exit_code -ne 0 ]; then
  echo ""
  echo "fast-cv found issues. Fix them before committing."
  echo "To bypass: git commit --no-verify"
  exit 1
fi
`;

      if (existsSync(hookPath)) {
        const existing = readFileSync(hookPath, 'utf-8');
        if (existing.includes('[fast-cv]')) {
          process.stdout.write('fast-cv pre-commit hook is already installed.\n');
          return;
        }
        if (!opts.force) {
          process.stderr.write(
            `Warning: ${hookPath} already exists (not a fast-cv hook).\n` +
            `Use --force to overwrite it.\n`
          );
          process.exit(EXIT_PRECHECK_FAILED);
        }
      }

      mkdirSync(hooksDir, { recursive: true });
      writeFileSync(hookPath, hookScript, 'utf-8');
      chmodSync(hookPath, 0o755);
      process.stdout.write(`fast-cv pre-commit hook installed at ${hookPath}\n`);
    });
}
