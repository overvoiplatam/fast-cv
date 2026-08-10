import { spawn } from 'node:child_process';

function spawnAndCollect(bin, args, opts) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const hasTimeout = Number.isFinite(opts.timeout) && opts.timeout > 0;

    const proc = spawn(bin, args, {
      cwd: opts.cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 0,
      detached: true,
    });

    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    let killed = false;
    const timer = hasTimeout
      ? setTimeout(() => {
        killed = true;
        // Kill the entire process group (bearer, semgrep, etc. spawn workers)
        try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* already dead */ }
        setTimeout(() => {
          try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* already dead */ }
        }, 5000);
      }, opts.timeout)
      : null;

    proc.on('close', (exitCode) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, killed });
    });

    proc.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout: '', stderr: err.message, exitCode: -1, killed: false, spawnError: err });
    });
  });
}

// Dedicated DB download step: runs with timeout 0 so a large download never
// competes with the tool's own scan budget (the user's -t is per-scan).
// Returns an error detail string on failure, null on success.
async function runDbUpdate(tool, targetDir, configPath, verbose) {
  if (verbose) process.stderr.write(`  Updating ${tool.name} databases...\n`);
  for (const cmd of tool.updateDbCommands(targetDir, configPath)) {
    const result = await spawnAndCollect(cmd.bin, cmd.args, { cwd: cmd.cwd, timeout: 0 });
    if (result.spawnError) return result.spawnError.message;
    if (result.exitCode !== 0) return result.stderr.slice(0, 500) || `exit code ${result.exitCode}`;
  }
  return null;
}

// preFixCommands are pure formatters — always safe to run regardless of where
// the config came from, unlike the tool's own --fix.
async function runPreFixCommands(tool, targetDir, configPath, toolFiles, timeout) {
  if (typeof tool.preFixCommands !== 'function') return;
  for (const cmd of tool.preFixCommands(targetDir, configPath, { files: toolFiles })) {
    await spawnAndCollect(cmd.bin, cmd.args, { cwd: cmd.cwd, timeout });
  }
}

function runSingleTool(tool, configPath, targetDir, timeout, { files = [], fix = false, licenses = false, updateDb = false, verbose = false, configSource = 'none', exclude = [] } = {}) {
  return new Promise(async (resolve) => {
    const start = Date.now();

    // Semantic fix is gated: shipped defaults only get formatting (preFixCommands), not --fix
    const effectiveFix = fix && configSource !== 'package-default';
    const fixSkipped = fix && !effectiveFix;

    try {
      const toolFiles = files.length > 0 && Array.isArray(tool.extensions)
        ? files.filter(f => tool.extensions.some(ext => f.endsWith(ext)))
        : files;

      if (fix) await runPreFixCommands(tool, targetDir, configPath, toolFiles, timeout);

      if (updateDb && typeof tool.updateDbCommands === 'function') {
        const dbError = await runDbUpdate(tool, targetDir, configPath, verbose);
        if (dbError) {
          resolve({
            tool: tool.name,
            findings: [],
            error: `${tool.name} DB update failed: ${dbError}`,
            duration: Date.now() - start,
            fixSkipped,
          });
          return;
        }
      }

      const { bin, args, cwd } = tool.buildCommand(targetDir, configPath, { files: toolFiles, fix: effectiveFix, licenses, exclude, configSource });

      const result = await spawnAndCollect(bin, args, { cwd, timeout });

      const duration = Date.now() - start;

      if (result.killed) {
        resolve({
          tool: tool.name,
          findings: [],
          error: `Timeout after ${(timeout / 1000).toFixed(0)}s`,
          duration,
          fixSkipped,
        });
        return;
      }

      if (result.spawnError) {
        resolve({
          tool: tool.name,
          findings: [],
          error: `Failed to spawn ${bin}: ${result.spawnError.message}`,
          duration,
          fixSkipped,
        });
        return;
      }

      try {
        const findings = tool.parseOutput(result.stdout, result.stderr, result.exitCode);
        resolve({
          tool: tool.name,
          findings,
          error: null,
          duration,
          fixSkipped,
        });
      } catch (err) {
        resolve({
          tool: tool.name,
          findings: [],
          error: err.message,
          duration,
          fixSkipped,
        });
      }
    } catch (err) {
      const duration = Date.now() - start;
      resolve({
        tool: tool.name,
        findings: [],
        error: `Failed to spawn ${tool.name}: ${err.message}`,
        duration,
        fixSkipped,
      });
    }
  });
}

export async function runTools(toolConfigs, targetDir, options = {}) {
  const timeout = Number.isFinite(options.timeout) && options.timeout > 0 ? options.timeout : 0;
  const files = options.files || [];
  const fix = options.fix || false;
  const licenses = options.licenses || false;
  const updateDb = options.updateDb || false;
  const verbose = options.verbose || false;
  const exclude = options.exclude || [];

  const results = [];
  for (const { tool, config } of toolConfigs) {
    if (verbose) process.stderr.write(`  Running ${tool.name}...\n`);

    const result = await runSingleTool(tool, config.path, targetDir, timeout, { files, fix, licenses, updateDb, verbose, configSource: config.source, exclude });

    if (verbose) {
      const status = result.error
        ? `error: ${result.error}`
        : `${result.findings.length} finding(s)`;
      process.stderr.write(`  ${tool.name} done (${(result.duration / 1000).toFixed(1)}s) — ${status}\n`);
    }
    results.push(result);
  }
  return results;
}
