import { Command } from 'commander';
import { resolve, basename } from 'node:path';
import { accessSync, constants } from 'node:fs';
import { pruneDirectory } from './pruner.js';
import { precheck } from './precheck.js';
import { resolveConfig } from './config-resolver.js';
import { runTools } from './runner.js';
import { formatReport, filterFindings } from './normalizer.js';
import { tools as allTools } from './tools/index.js';

const EXIT_CLEAN = 0;
const EXIT_FINDINGS = 1;
const EXIT_PRECHECK_FAILED = 2;

export async function run(argv) {
  const program = new Command();

  program
    .name('fast-cv')
    .description('Fast Code Validation — parallel linters & security scanners with unified Markdown reports')
    .version('0.1.0')
    .argument('[directory]', 'target directory to scan', '.')
    .option('-t, --timeout <seconds>', 'per-tool timeout in seconds', '120')
    .option('--tools <names>', 'comma-separated list of tools to run (default: all applicable)')
    .option('-v, --verbose', 'show detailed output on stderr', false)
    .option('--auto-install', 'automatically install missing tools', false)
    .option('-x, --exclude <patterns>', 'comma-separated ignore patterns (gitignore syntax)', '')
    .action(async (directory, options) => {
      const targetDir = resolve(directory);

      try {
        accessSync(targetDir, constants.R_OK);
      } catch {
        process.stderr.write(`Error: directory not found or not readable: ${targetDir}\n`);
        process.exit(EXIT_PRECHECK_FAILED);
      }

      const timeout = parseInt(options.timeout, 10) * 1000;
      const verbose = options.verbose;
      const exclude = options.exclude
        ? options.exclude.split(',').map(s => s.trim()).filter(Boolean)
        : [];

      // Step 1: Prune directory
      if (verbose) process.stderr.write(`Scanning ${targetDir}...\n`);
      const { files, languages, ignoreFilter } = await pruneDirectory(targetDir, { exclude });
      if (verbose) process.stderr.write(`Found ${files.length} files, languages: ${[...languages].join(', ')}\n`);

      if (files.length === 0) {
        process.stdout.write(formatReport({ targetDir, results: [], warnings: ['No scannable files found.'] }));
        process.exit(EXIT_CLEAN);
      }

      // Step 2: Filter tools by detected languages and --tools flag
      let applicableTools = allTools.filter(tool =>
        tool.extensions.some(ext => languages.has(ext))
      );

      if (options.tools) {
        const requested = options.tools.split(',').map(s => s.trim().toLowerCase());
        applicableTools = applicableTools.filter(t => requested.includes(t.name));
      }

      if (applicableTools.length === 0) {
        process.stdout.write(formatReport({ targetDir, results: [], warnings: ['No applicable tools for detected languages.'] }));
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

      // Step 5: Run tools in parallel
      if (verbose) process.stderr.write(`Running ${readyTools.map(t => t.name).join(', ')}...\n`);
      const results = await runTools(toolConfigs, targetDir, { timeout, verbose });

      // Step 6: Post-filter findings through ignore rules
      const filtered = filterFindings(results, targetDir, ignoreFilter);

      // Step 7: Format and output report
      const warnings = precheckResult.warnings || [];
      const report = formatReport({ targetDir, results: filtered, warnings });
      process.stdout.write(report);

      const hasFindings = filtered.some(r => r.findings && r.findings.length > 0);
      process.exit(hasFindings ? EXIT_FINDINGS : EXIT_CLEAN);
    });

  await program.parseAsync(argv);
}
