import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function tryAutoInstall(tool, verbose) {
  const cmd = tool.installHint;
  if (!cmd) return false;

  if (verbose) {
    process.stderr.write(`  Installing ${tool.name}: ${cmd}\n`);
  }

  try {
    // Parse the install hint into command + args
    // Handle pipe commands (curl ... | sh) by running through shell
    if (cmd.includes('|')) {
      await execFileAsync('bash', ['-c', cmd], { timeout: 300000 });
    } else {
      const parts = cmd.split(/\s+/);
      await execFileAsync(parts[0], parts.slice(1), { timeout: 300000 });
    }
    return true;
  } catch {
    return false;
  }
}

export async function precheck(tools, options = {}) {
  const { autoInstall = false, verbose = false } = options;

  const missing = [];
  const ready = [];
  const warnings = [];

  // Check each tool in parallel
  const checks = await Promise.allSettled(
    tools.map(async (tool) => {
      try {
        const installed = await tool.checkInstalled();
        return { tool, installed };
      } catch {
        return { tool, installed: false };
      }
    })
  );

  for (const result of checks) {
    const { tool, installed } = result.value;
    if (installed) {
      ready.push(tool);
    } else {
      missing.push({ tool });
    }
  }

  if (missing.length === 0) {
    return { ok: true, tools: ready, warnings };
  }

  // Attempt auto-install if requested
  if (autoInstall) {
    for (const { tool } of missing) {
      const success = await tryAutoInstall(tool, verbose);
      if (success) {
        // Verify it actually works now
        const nowInstalled = await tool.checkInstalled();
        if (nowInstalled) {
          ready.push(tool);
          warnings.push(`${tool.name}: auto-installed successfully`);
          continue;
        }
      }
      warnings.push(`${tool.name}: auto-install failed — ${tool.installHint}`);
    }
    // If we managed to install everything, proceed
    return { ok: true, tools: ready, warnings };
  }

  // Build failure message
  const lines = [
    '[PRECHECK FAILED] Missing tools for detected languages:\n',
    '',
  ];

  for (const { tool } of missing) {
    lines.push(`  ${tool.name} (needed for ${tool.extensions.join(', ')} files)`);
    lines.push(`    Install: ${tool.installHint}`);
    lines.push('');
  }

  lines.push('Run with --auto-install to install missing tools automatically.');
  lines.push('Or run ./install.sh from the fast-cv repo for a full setup.');
  lines.push('');

  return {
    ok: false,
    tools: ready,
    warnings,
    message: lines.join('\n'),
  };
}
