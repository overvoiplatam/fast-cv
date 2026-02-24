# fast-cv (Fast Code Validation)

A local, offline CLI tool that orchestrates multiple linters and security scanners in parallel, producing a unified tagged Markdown report optimized for LLM/AI agent consumption.

## Supported Tools

| Tool | Languages | Tags |
|------|-----------|------|
| [ruff](https://github.com/astral-sh/ruff) | Python | `[LINTER]` `[FORMAT]` `[SECURITY]` `[REFACTOR]` `[BUG]` |
| [eslint](https://eslint.org) | JS, TS, JSX, TSX | `[LINTER]` |
| [semgrep](https://semgrep.dev) | Python, JS, TS, Go, Java, Ruby | `[SECURITY]` `[BUG]` |
| [bearer](https://github.com/Bearer/bearer) | Python, JS, TS, Go, Java, Ruby, PHP | `[PRIVACY]` |
| [golangci-lint](https://golangci-lint.run) | Go | `[LINTER]` |

Tools are automatically selected based on detected file types. Missing tools are skipped gracefully.

## Install

```bash
# Clone and install
git clone https://github.com/<user>/fast-cv.git
cd fast-cv
./install.sh
```

The installer handles everything: Node.js dependencies, linter binaries, default configs, and global `fast-cv` command.

### Reinstalling

When a previous installation is detected, the installer prompts you to choose:

```bash
./install.sh              # Interactive: choose what to reinstall
./install.sh --mode all     # Full reinstall (app + tools + configs)
./install.sh --mode app     # Reinstall application only (npm deps + link)
./install.sh --mode configs # Reinstall default configs (overwrites existing)
```

### Requirements

- Node.js >= 20
- npm
- git
- python3 + pip3 (for ruff, semgrep)
- curl (for bearer, golangci-lint installers)

## Usage

```bash
fast-cv [directory] [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-t, --timeout <seconds>` | Per-tool timeout | `120` |
| `--tools <names>` | Comma-separated tool list | all applicable |
| `-v, --verbose` | Show detailed output on stderr | `false` |
| `--auto-install` | Auto-install missing tools | `false` |

### Examples

```bash
# Scan current directory
fast-cv .

# Scan a specific project
fast-cv /path/to/project

# Run only ruff and eslint
fast-cv . --tools ruff,eslint

# Auto-install any missing tools, then scan
fast-cv . --auto-install

# 30-second timeout per tool, verbose
fast-cv . --timeout 30 -v
```

## Output Format

fast-cv produces tagged Markdown grouped by file:

```markdown
# fast-cv report

**Target**: `/path/to/project`
**Date**: 2026-02-23T18:30:00Z
**Tools**: ruff (0.4s), eslint (1.1s), semgrep (3.2s)

---

## Findings (12 issues)

### `src/auth/login.py`

- **[SECURITY]** `S105` Hardcoded password detected (line 42)
- **[LINTER]** `F401` `os` imported but unused (line 1)
- **[FORMAT]** `E302` Expected 2 blank lines, found 1 (line 15)

### `src/api/handler.js`

- **[LINTER]** `no-eval` Unexpected use of eval() (line 88, col 5)

---

*12 findings from 3 tools in 4.7s*
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Clean — no findings |
| `1` | Findings exist |
| `2` | Precheck failed (missing tools) |

## Configuration

fast-cv resolves configs with a fallback chain (first match wins):

1. **Local**: Config file in the scanned directory (e.g., `ruff.toml`, `eslint.config.js`)
2. **User default**: `~/.config/fast-cv/defaults/<file>`
3. **Package default**: Shipped baseline configs in `defaults/`
4. **None**: Tool uses its own built-in defaults

### Ignoring Files

fast-cv respects `.gitignore` and also supports `.fcvignore` for project-specific overrides. Common directories (`node_modules`, `__pycache__`, `.venv`, `dist`, `build`, etc.) and lock files are always ignored.

## Development

```bash
# Run tests
npm test

# Run a specific test file
node --test test/pruner.test.js

# Self-scan
node bin/fast-cv.js .
```

## License

MIT
