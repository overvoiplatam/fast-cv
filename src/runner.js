import { spawn } from 'node:child_process';

function runSingleTool(tool, configPath, targetDir, timeout) {
  return new Promise((resolve) => {
    const start = Date.now();
    const { bin, args } = tool.buildCommand(targetDir, configPath);

    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn(bin, args, {
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 0, // We handle timeout ourselves
    });

    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    // Timeout handling
    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      // Grace period
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      }, 5000);
    }, timeout);

    proc.on('close', (exitCode) => {
      clearTimeout(timer);
      const duration = Date.now() - start;

      if (killed) {
        resolve({
          tool: tool.name,
          findings: [],
          error: `Timeout after ${(timeout / 1000).toFixed(0)}s`,
          duration,
        });
        return;
      }

      try {
        const findings = tool.parseOutput(stdout, stderr, exitCode);
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
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      const duration = Date.now() - start;
      resolve({
        tool: tool.name,
        findings: [],
        error: `Failed to spawn ${bin}: ${err.message}`,
        duration,
      });
    });
  });
}

export async function runTools(toolConfigs, targetDir, options = {}) {
  const timeout = options.timeout || 120000;

  const promises = toolConfigs.map(({ tool, config }) =>
    runSingleTool(tool, config.path, targetDir, timeout)
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
