# Configuration

## Resolution Chain

fast-cv resolves tool configs in priority order. First match wins.

| Priority | Source | Path Pattern | Example |
|----------|--------|-------------|---------|
| 1 | Local project | `<targetDir>/<config-file>` | `./ruff.toml` |
| 2 | User global | `~/.config/fast-cv/defaults/<file>` | `~/.config/fast-cv/defaults/ruff.toml` |
| 3 | Package default | `<fast-cv>/defaults/<file>` | shipped `defaults/ruff.toml` |
| 4 | None | — | Tool runs with its own defaults |

Implementation: `src/config-resolver.js`

## Config Files Per Tool

| Tool | Local Candidates (checked in order) | Package Default |
|------|--------------------------------------|-----------------|
| ruff | `ruff.toml`, `.ruff.toml`, `pyproject.toml` | `defaults/ruff.toml` |
| eslint | `eslint.config.js`, `eslint.config.mjs`, `eslint.config.cjs`, `.eslintrc.json`, `.eslintrc.js`, `.eslintrc.yml`, `.eslintrc.yaml`, `.eslintrc` | `defaults/eslint.config.mjs` |
| semgrep | `.semgrep.yml`, `.semgrep.yaml`, `.semgrep/` | `defaults/semgrep/` (directory) |
| bearer | `.bearer.yml`, `bearer.yml` | — |
| golangci-lint | `.golangci.yml`, `.golangci.yaml`, `.golangci.toml`, `.golangci.json` | `defaults/.golangci.yml` |
| jscpd | `.jscpd.json` | — |
| trivy | `trivy.yaml`, `.trivy.yaml` | — |
| mypy | `mypy.ini`, `.mypy.ini`, `setup.cfg`, `pyproject.toml` | `defaults/mypy.ini` |
| typos | `typos.toml`, `.typos.toml`, `_typos.toml` | — |
| vulture | — (reads `pyproject.toml [tool.vulture]` natively) | — |
| knip | `knip.json`, `knip.jsonc`, `.knip.json` | — |
| tsc | `tsconfig.json` | — |
| clippy | `clippy.toml`, `.clippy.toml` | — |
| stylelint | `.stylelintrc`, `.stylelintrc.json`, `.stylelintrc.yml`, `.stylelintrc.yaml`, `stylelint.config.js`, `stylelint.config.mjs`, `stylelint.config.cjs` | `defaults/.stylelintrc.json` |
| sqlfluff | `.sqlfluff`, `setup.cfg`, `pyproject.toml` | — |

## Shipped Defaults

### `defaults/ruff.toml`
- Line length: 120
- Enables: pyflakes (F), pycodestyle (E/W), isort (I), flake8-simplify (SIM), flake8-bugbear (B), bandit security (S), performance (PERF), refactoring (UP)
- Ignores: E501 (line length), E402 (module-level import)

### `defaults/eslint.config.mjs`
- Plugins: `eslint-plugin-security`, `eslint-plugin-sonarjs`, `typescript-eslint`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-vue`, `eslint-plugin-svelte`, `eslint-plugin-jsonc`, `eslint-plugin-jsdoc`
- All plugins loaded resiliently (graceful degradation if not installed)
- Security rules at "warn" level
- SonarJS cognitive complexity + code smell rules
- JSDoc rules for docstring enforcement (require-jsdoc, require-description, require-param, require-returns)

### `defaults/.stylelintrc.json`
- Standard CSS config with common style rules

### `defaults/.golangci.yml`
- Enables: gocognit, gocritic, revive
- Revive configured with `exported` rule for doc comment enforcement on exported symbols

### `defaults/mypy.ini`
- `ignore_missing_imports = True` — doesn't fail on uninstalled stubs

### `defaults/semgrep/`
- `taint.yaml` — 6 custom taint-tracking rules (SQL injection, XSS, command injection, path traversal, SSRF, log injection)
- `owasp-top-ten.yaml` — ~543 community OWASP rules (downloaded during `install.sh`)

Note: semgrep reads all `.yaml` files in the directory. The `config-resolver.js` `fileExists()` uses `fs.access()` which works for both files and directories.

## Ignore System

Files are excluded via a layered ignore system in `src/pruner.js`:

| Source | Applied At | Notes |
|--------|-----------|-------|
| Hardcoded dirs | Always | `node_modules`, `dist`, `build`, `.git`, `__pycache__`, etc. (L8-70) |
| Hardcoded files | Always | Lock files: `package-lock.json`, `yarn.lock`, etc. (L72-81) |
| `.gitignore` | Auto-loaded | Standard git ignore patterns (L131) |
| `.fcvignore` | Auto-loaded | fast-cv-specific ignore file (L135) |
| `--exclude` | CLI flag | Additional patterns via command line (L127) |
| `--only` | CLI flag | Inverse — scan only matching files |

All patterns use gitignore syntax via the `ignore` npm package.

## CLI Reference

| Flag | Default | Description |
|------|---------|-------------|
| `[directory]` | `.` | Target directory to scan |
| `-t, --timeout <seconds>` | `120` | Per-tool timeout |
| `--tools <names>` | all applicable | Comma-separated tool list |
| `-v, --verbose` | `false` | Show detailed output on stderr |
| `--auto-install` | `false` | Auto-install missing tools |
| `-x, --exclude <patterns>` | — | Comma-separated ignore patterns |
| `--only <patterns>` | — | Scan only matching files/globs |
| `--fix` | `false` | Run only fix-capable tools, apply fixes, and exit (no findings report; see Fix Safety below) |
| `--licenses` | `false` | Include license compliance scanning (trivy) |
| `--sbom` | `false` | Generate CycloneDX SBOM (trivy, early exit) |
| `--max-lines <number>` | `600` | Flag files exceeding this line count (0 to disable) |
| `--max-lines-omit <patterns>` | — | Comma-separated patterns to exclude from line count check |
| `--git-only [scope]` | `false` | Scan only git-changed files (`--git-only` = uncommitted+unpushed, `--git-only=uncommitted` = working tree only) |
| `--no-docstring` | `false` | Suppress documentation findings (DOCS tag) |
| `-f, --format <type>` | `markdown` | Output format: `markdown` or `sarif` |

### Fix Safety

`--fix` behavior depends on config source to prevent shipped default configs from making dangerous semantic changes to projects that didn't opt in:

| Config Source | Formatting (`preFixCommands`) | Semantic (`--fix` flag) | Example |
|---|---|---|---|
| `package-default` | Runs | Skipped | ruff format runs, ruff check --fix does not |
| `local` | Runs | Runs | Project opted in — full fix |
| `user-default` | Runs | Runs | User explicitly configured |
| `none` | N/A | Runs | Tool uses its own defaults |

When semantic fix is skipped, a warning appears in the report. To get full `--fix` behavior, provide a local config file for the tool.

### Subcommands

| Command | Description |
|---------|-------------|
| `fast-cv install-hook [dir]` | Install git pre-commit hook |
| `fast-cv install-hook --force` | Overwrite existing hook |
