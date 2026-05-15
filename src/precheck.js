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
  const warnings = [];

  const { ready, missing } = await partitionByInstalled(tools);
  if (missing.length === 0) return { ok: true, tools: ready, warnings };

  if (autoInstall) {
    await runAutoInstall(missing, ready, warnings, verbose);
    return { ok: true, tools: ready, warnings };
  }

  if (ready.length > 0) {
    for (const { tool } of missing) {
      warnings.push(`${tool.name} not found — skipped (install: ${tool.installHint})`);
    }
    return { ok: true, tools: ready, warnings };
  }

  return { ok: false, tools: ready, warnings, message: buildMissingMessage(missing) };
}

async function partitionByInstalled(tools) {
  const ready = [];
  const missing = [];
  const checks = await Promise.allSettled(tools.map(async (tool) => {
    try {
      return { tool, installed: await tool.checkInstalled() };
    } catch {
      return { tool, installed: false };
    }
  }));
  for (const result of checks) {
    const { tool, installed } = result.value;
    if (installed) ready.push(tool);
    else missing.push({ tool });
  }
  return { ready, missing };
}

async function runAutoInstall(missing, ready, warnings, verbose) {
  for (const { tool } of missing) {
    const installed = await tryAutoInstall(tool, verbose) && await tool.checkInstalled();
    if (installed) {
      ready.push(tool);
      warnings.push(`${tool.name}: auto-installed successfully`);
    } else {
      warnings.push(`${tool.name}: auto-install failed — ${tool.installHint}`);
    }
  }
}

function buildMissingMessage(missing) {
  const lines = ['[PRECHECK FAILED] No tools available — all applicable tools are missing:\n', ''];
  for (const { tool } of missing) {
    lines.push(`  ${tool.name} (needed for ${tool.extensions.join(', ')} files)`);
    lines.push(`    Install: ${tool.installHint}`);
    lines.push('');
  }
  lines.push('Run with --auto-install to install missing tools automatically.');
  lines.push('Or run ./install.sh from the fast-cv repo for a full setup.');
  lines.push('');
  return lines.join('\n');
}
