import { spawn } from 'node:child_process';

function spawnAndCollect(bin, args, opts) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

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
    const timer = setTimeout(() => {
      killed = true;
      // Kill the entire process group (bearer, semgrep, etc. spawn workers)
      try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* already dead */ }
      setTimeout(() => {
        try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* already dead */ }
      }, 5000);
    }, opts.timeout);

    proc.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, killed });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout: '', stderr: err.message, exitCode: -1, killed: false, spawnError: err });
    });
  });
}

function runSingleTool(tool, configPath, targetDir, timeout, { files = [], fix = false, licenses = false, configSource = 'none' } = {}) {
  return new Promise(async (resolve) => {
    const start = Date.now();

    // Semantic fix is gated: shipped defaults only get formatting (preFixCommands), not --fix
    const effectiveFix = fix && configSource !== 'package-default';
    const fixSkipped = fix && !effectiveFix;

    try {
      // Run preFixCommands sequentially if in fix mode and tool supports them
      // preFixCommands are pure formatters — always safe regardless of config source
      if (fix && typeof tool.preFixCommands === 'function') {
        const preCmds = tool.preFixCommands(targetDir, configPath, { files });
        for (const cmd of preCmds) {
          await spawnAndCollect(cmd.bin, cmd.args, {
            cwd: cmd.cwd,
            timeout,
          });
        }
      }

      const { bin, args, cwd } = tool.buildCommand(targetDir, configPath, { files, fix: effectiveFix, licenses });

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
  const timeout = options.timeout || 120000;
  const files = options.files || [];
  const fix = options.fix || false;
  const licenses = options.licenses || false;
  const verbose = options.verbose || false;

  const results = [];
  for (const { tool, config } of toolConfigs) {
    if (verbose) process.stderr.write(`  Running ${tool.name}...\n`);

    const result = await runSingleTool(tool, config.path, targetDir, timeout, { files, fix, licenses, configSource: config.source });

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
