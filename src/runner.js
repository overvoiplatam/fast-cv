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
    });

    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* already dead */ }
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

function runSingleTool(tool, configPath, targetDir, timeout, { files = [], fix = false, licenses = false } = {}) {
  return new Promise(async (resolve) => {
    const start = Date.now();

    try {
      // Run preFixCommands sequentially if in fix mode and tool supports them
      if (fix && typeof tool.preFixCommands === 'function') {
        const preCmds = tool.preFixCommands(targetDir, configPath, { files });
        for (const cmd of preCmds) {
          await spawnAndCollect(cmd.bin, cmd.args, {
            cwd: cmd.cwd,
            timeout,
          });
        }
      }

      const { bin, args, cwd } = tool.buildCommand(targetDir, configPath, { files, fix, licenses });

      const result = await spawnAndCollect(bin, args, { cwd, timeout });

      const duration = Date.now() - start;

      if (result.killed) {
        resolve({
          tool: tool.name,
          findings: [],
          error: `Timeout after ${(timeout / 1000).toFixed(0)}s`,
          duration,
        });
        return;
      }

      if (result.spawnError) {
        resolve({
          tool: tool.name,
          findings: [],
          error: `Failed to spawn ${bin}: ${result.spawnError.message}`,
          duration,
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
        });
      } catch (err) {
        resolve({
          tool: tool.name,
          findings: [],
          error: err.message,
          duration,
        });
      }
    } catch (err) {
      const duration = Date.now() - start;
      resolve({
        tool: tool.name,
        findings: [],
        error: `Failed to spawn ${tool.name}: ${err.message}`,
        duration,
      });
    }
  });
}

export async function runTools(toolConfigs, targetDir, options = {}) {
  const timeout = options.timeout || 120000;
  const files = options.files || [];
  const fix = options.fix || false;
  const licenses = options.licenses || false;

  const promises = toolConfigs.map(({ tool, config }) =>
    runSingleTool(tool, config.path, targetDir, timeout, { files, fix, licenses })
  );

  const settled = await Promise.allSettled(promises);

  return settled.map(result => {
    if (result.status === 'fulfilled') return result.value;
    return {
      tool: 'unknown',
      findings: [],
      error: result.reason?.message || 'Unknown error',
      duration: 0,
    };
  });
}
