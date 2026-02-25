import { Command, Option } from 'commander';
import { resolve } from 'node:path';
import { accessSync, constants, existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { pruneDirectory } from './pruner.js';
import { precheck } from './precheck.js';
import { resolveConfig } from './config-resolver.js';
import { runTools } from './runner.js';
import { formatReport, filterFindings } from './normalizer.js';
import { formatSarif } from './sarif.js';
import { tools as allTools } from './tools/index.js';
import { checkFileLines } from './line-check.js';

const EXIT_CLEAN = 0;
const EXIT_FINDINGS = 1;
const EXIT_PRECHECK_FAILED = 2;

export async function run(argv) {
  const program = new Command();

  program
    .name('fast-cv')
    .description('Fast Code Validation — sequential linters & security scanners with unified Markdown reports')
    .version('0.2.0')
    .argument('[directory]', 'target directory to scan', '.')
    .option('-t, --timeout <seconds>', 'per-tool timeout in seconds', '120')
    .option('--tools <names>', 'comma-separated list of tools to run (default: all applicable)')
    .option('-v, --verbose', 'show detailed output on stderr', false)
    .option('--auto-install', 'automatically install missing tools', false)
    .option('-x, --exclude <patterns>', 'comma-separated ignore patterns (gitignore syntax)', '')
    .option('--only <patterns>', 'comma-separated file paths or glob patterns to scan exclusively', '')
    .option('--fix', 'auto-fix formatting/style issues where supported', false)
    .option('--licenses', 'include open-source license compliance scanning (trivy)', false)
    .option('--sbom', 'generate CycloneDX SBOM inventory (requires trivy)', false)
    .option('--max-lines <number>', 'flag files exceeding this line count (0 to disable)', '600')
    .option('--max-lines-omit <patterns>', 'comma-separated patterns to exclude from line count check (gitignore syntax)', '')
    .addOption(new Option('-f, --format <type>', 'output format').choices(['markdown', 'sarif']).default('markdown'))
    .action(async (directory, options) => {
      const targetDir = resolve(directory);

      try {
        accessSync(targetDir, constants.R_OK);
      } catch {
        process.stderr.write(`Error: directory not found or not readable: ${targetDir}\n`);
        process.exit(EXIT_PRECHECK_FAILED);
      }

      // SBOM generation — early exit, bypasses normal scan pipeline
      if (options.sbom) {
        const trivyTool = allTools.find(t => t.name === 'trivy');
        const installed = trivyTool && await trivyTool.checkInstalled();
        if (!installed) {
          process.stderr.write(`Error: trivy is required for SBOM generation. ${trivyTool?.installHint || ''}\n`);
          process.exit(EXIT_PRECHECK_FAILED);
        }
        const { spawn: spawnProc } = await import('node:child_process');
        const proc = spawnProc('trivy', ['fs', '--format', 'cyclonedx', '--quiet', targetDir],
          { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        proc.stdout.on('data', c => { stdout += c; });
        proc.stderr.on('data', c => { stderr += c; });
        await new Promise(r => proc.on('close', r));
        if (!stdout.trim()) {
          process.stderr.write(`trivy SBOM error: ${stderr.slice(0, 500)}\n`);
          process.exit(EXIT_PRECHECK_FAILED);
        }
        process.stdout.write(stdout);
        process.exit(EXIT_CLEAN);
      }

      const timeout = parseInt(options.timeout, 10) * 1000;
      const verbose = options.verbose;
      const exclude = options.exclude
        ? options.exclude.split(',').map(s => s.trim()).filter(Boolean)
        : [];
      const only = options.only
        ? options.only.split(',').map(s => s.trim()).filter(Boolean)
        : [];
      const fix = options.fix;
      const licenses = options.licenses;
      const maxLines = parseInt(options.maxLines, 10);
      const maxLinesOmit = options.maxLinesOmit
        ? options.maxLinesOmit.split(',').map(s => s.trim()).filter(Boolean)
        : [];
      const fmt = options.format === 'sarif' ? formatSarif : formatReport;

      // Step 1: Prune directory
      if (verbose) process.stderr.write(`Scanning ${targetDir}...\n`);
      const { files, languages, ignoreFilter, onlyFilter } = await pruneDirectory(targetDir, { exclude, only });
      if (verbose) process.stderr.write(`Found ${files.length} files, languages: ${[...languages].join(', ')}\n`);

      if (files.length === 0) {
        process.stdout.write(fmt({ targetDir, results: [], warnings: ['No scannable files found.'] }));
        process.exit(EXIT_CLEAN);
      }

      // Step 2: Filter tools by detected languages and --tools flag
      const requested = options.tools
        ? options.tools.split(',').map(s => s.trim().toLowerCase())
        : null;

      let applicableTools = allTools.filter(tool => {
        const hasExtension = tool.extensions.some(ext => languages.has(ext));
        if (!hasExtension) return false;
        // Opt-in tools only run when explicitly requested via --tools
        if (tool.optIn && (!requested || !requested.includes(tool.name))) return false;
        return true;
      });

      if (requested) {
        applicableTools = applicableTools.filter(t => requested.includes(t.name));
      }

      if (applicableTools.length === 0) {
        process.stdout.write(fmt({ targetDir, results: [], warnings: ['No applicable tools for detected languages.'] }));
        process.exit(EXIT_CLEAN);
      }

      // Step 3: Precheck — verify tools are installed
      const precheckResult = await precheck(applicableTools, { autoInstall: options.autoInstall, verbose });
      if (!precheckResult.ok) {
        process.stderr.write(precheckResult.message);
        process.exit(EXIT_PRECHECK_FAILED);
      }

      const readyTools = precheckResult.tools;

      // Step 4: Resolve configs
      const toolConfigs = await Promise.all(
        readyTools.map(async tool => ({
          tool,
          config: await resolveConfig(tool.name, targetDir),
        }))
      );

      // Step 5: Run tools sequentially
      if (verbose) process.stderr.write(`Running ${readyTools.map(t => t.name).join(', ')}...\n`);
      const passFiles = only.length > 0 || (fix && exclude.length > 0);
      const results = await runTools(toolConfigs, targetDir, { timeout, verbose, files: passFiles ? files : [], fix, licenses });

      // Step 5b: Built-in line-count check
      if (maxLines > 0) {
        const lineResult = await checkFileLines(files, targetDir, { maxLines, omitPatterns: maxLinesOmit });
        results.push(lineResult);
      }

      // Step 6: Post-filter findings through ignore rules
      const filtered = filterFindings(results, targetDir, ignoreFilter, onlyFilter);

      // Step 7: Format and output report
      const warnings = precheckResult.warnings || [];
      const report = fmt({ targetDir, results: filtered, warnings, fix });
      process.stdout.write(report);

      const hasFindings = filtered.some(r => r.findings && r.findings.length > 0);
      process.exit(hasFindings ? EXIT_FINDINGS : EXIT_CLEAN);
    });

  // install-hook subcommand
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
fast-cv . --timeout 60
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

  await program.parseAsync(argv);
}
