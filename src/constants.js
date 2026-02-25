export const SCANNABLE_EXTENSIONS = [
  '.py', '.pyi',
  '.js', '.jsx', '.mjs', '.cjs',
  '.ts', '.tsx', '.mts', '.cts',
  '.go',
  '.java',
  '.rb',
  '.php',
  '.rs',
  '.c', '.h', '.cpp', '.hpp',
  '.cs',
  '.swift',
  '.kt', '.kts',
  '.scala',
  '.sh', '.bash',
  '.yaml', '.yml',
  '.json',
  '.toml',
  '.tf',
  '.sql',
  '.css', '.scss', '.sass', '.less',
  '.svelte', '.vue',
];

export function parseJsonLines(stdout) {
  return stdout.trim().split('\n')
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}
