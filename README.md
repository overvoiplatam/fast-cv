# fast-cv (Fast Code Validation)

A local, offline CLI tool that orchestrates multiple linters and security scanners in parallel, producing a unified tagged Markdown report optimized for LLM/AI agent consumption.

## Supported Tools

| Tool | Languages | Tags |
|------|-----------|------|
| [ruff](https://github.com/astral-sh/ruff) | Python | `[LINTER]` `[FORMAT]` `[SECURITY]` `[REFACTOR]` `[BUG]` `[DOCS]` |
| [eslint](https://eslint.org) + [security](https://github.com/eslint-community/eslint-plugin-security) + [sonarjs](https://github.com/SonarSource/eslint-plugin-sonarjs) | JS, TS, JSX, TSX | `[LINTER]` `[SECURITY]` `[REFACTOR]` `[BUG]` |
| [semgrep](https://semgrep.dev) | Python, JS, TS, Go, Java, Ruby, PHP, Rust, C/C++, C#, Kotlin, Swift, Scala | `[SECURITY]` `[BUG]` (OWASP Top 10 + custom taint rules) |
| [bearer](https://github.com/Bearer/bearer) | Python, JS, TS, Go, Java, Ruby, PHP | `[PRIVACY]` |
| [golangci-lint](https://golangci-lint.run) | Go | `[LINTER]` `[REFACTOR]` `[BUG]` `[SECURITY]` |
| [jscpd](https://github.com/kucherenko/jscpd) | All supported languages | `[DUPLICATION]` |
| [trivy](https://github.com/aquasecurity/trivy) | Python, JS, Go, Java, Ruby, PHP, Terraform, Rust, Kotlin, C#, C/C++, Swift, SQL | `[DEPENDENCY]` `[INFRA]` `[SECRET]` `[LICENSE]` |
| [mypy](https://mypy-lang.org) | Python | `[TYPE_ERROR]` |
| [vulture](https://github.com/jendrikseipp/vulture) | Python | `[DEAD_CODE]` |
| [typos](https://github.com/crate-ci/typos) | All supported languages | `[TYPO]` (opt-in) |
| [knip](https://knip.dev) | JS, TS | `[DEAD_CODE]` |

Tools are automatically selected based on detected file types. Missing tools are skipped gracefully. Tools marked **(opt-in)** only run when explicitly requested via `--tools`.

## Language Coverage

What fast-cv checks per language. Columns use checkmarks for clarity; tool names shown where only one tool applies.

| Language | Linting | SAST | SCA | Types | Privacy | Dead Code | Duplication | Typos\* | Secrets/IaC |
|----------|:-------:|:----:|:---:|:-----:|:-------:|:---------:|:-----------:|:-------:|:-----------:|
| **Python** | ruff | semgrep | trivy | mypy | bearer | vulture | jscpd | typos | trivy |
| **JavaScript** | eslint | semgrep | trivy | — | bearer | knip | jscpd | typos | trivy |
| **TypeScript** | eslint | semgrep | trivy | — | bearer | knip | jscpd | typos | trivy |
| **Go** | golangci-lint | semgrep | trivy | — | bearer | — | jscpd | typos | trivy |
| **Java** | — | semgrep | trivy | — | bearer | — | jscpd | typos | trivy |
| **Ruby** | — | semgrep | trivy | — | bearer | — | jscpd | typos | trivy |
| **PHP** | — | semgrep | trivy | — | bearer | — | jscpd | typos | trivy |
| **Rust** | — | semgrep | trivy | — | — | — | jscpd | typos | trivy |
| **C/C++** | — | semgrep | trivy | — | — | — | jscpd | typos | trivy |
| **C#** | — | semgrep | trivy | — | — | — | jscpd | typos | trivy |
| **Kotlin** | — | semgrep | trivy | — | — | — | jscpd | typos | trivy |
| **Swift** | — | semgrep | trivy | — | — | — | jscpd | typos | trivy |
| **Scala** | — | semgrep | — | — | — | — | jscpd | typos | — |
| **SQL** | — | — | trivy | — | — | — | jscpd | typos | — |
| **HTML** | — | — | — | — | — | — | — | — | — |
| **CSS/SCSS** | — | — | — | — | — | — | — | — | — |

\* typos is an **opt-in** tool (requires `--tools=typos`).

**Best covered**: Python (8 tools), JavaScript/TypeScript (7 tools), Go (6 tools).
**Not covered**: HTML, CSS/SCSS/SASS/LESS — fast-cv focuses on backend, infrastructure, and security. Use dedicated frontend linters (stylelint, htmlhint) for these.

## Security Architecture

fast-cv implements a five-pillar security model that provides bank-grade coverage across different vulnerability classes:

| Pillar | Tool | What it catches | Tag |
|--------|------|----------------|-----|
| **SAST** (Static Analysis) | Semgrep (OWASP Top 10 + custom taint rules) | SQL injection, XSS, SSRF, broken auth, insecure deserialization | `[SECURITY]` |
| **SCA** (Software Composition) | Trivy | CVEs in dependencies (requirements.txt, package-lock.json, go.sum) | `[DEPENDENCY]` |
| **IaC** (Infrastructure as Code) | Trivy | Dockerfile misconfigs, privileged containers, Terraform issues | `[INFRA]` |
| **Secrets/PII** | Trivy + Bearer | Hardcoded API keys, AWS tokens, passwords + PII data flows | `[SECRET]` `[PRIVACY]` |
| **License Compliance** | Trivy (`--licenses`) | Restrictive licenses (AGPL, GPL) in dependencies | `[LICENSE]` |

### Offline-first design

- **Semgrep OWASP rules**: The full [OWASP Top 10](https://semgrep.dev/p/owasp-top-ten) ruleset (~543 rules) is downloaded once during `./install.sh` and stored at `~/.config/fast-cv/defaults/semgrep/owasp-top-ten.yaml`. After install, all SAST scanning is fully offline. Custom taint rules (`taint.yaml`) are shipped alongside.
- **Trivy CVE database**: Auto-updates every 6 hours on first run, then all SCA/IaC/secret scanning is fully offline.

## Install

```bash
# Clone and install
git clone https://github.com/overvoiplatam/fast-cv.git
cd fast-cv
./install.sh
```

The installer handles everything: Node.js dependencies, linter binaries, default configs, OWASP semgrep rules download, and global `fast-cv` command.

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
- python3 + pip3 (for ruff, semgrep, mypy, vulture)
- curl (for bearer, golangci-lint, trivy installers + OWASP rules download)
- cargo (optional, for typos-cli)
- npx (for knip, included with Node.js)

## Usage

```bash
fast-cv [directory] [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-t, --timeout <seconds>` | Per-tool timeout | `120` |
| `--tools <names>` | Comma-separated tool list | all applicable |
| `-f, --format <type>` | Output format (`markdown` or `sarif`) | `markdown` |
| `-x, --exclude <patterns>` | Comma-separated ignore patterns (gitignore syntax) | none |
| `--only <patterns>` | Comma-separated file paths or glob patterns to scan exclusively | none |
| `--fix` | Auto-fix formatting/style issues where supported | `false` |
| `--licenses` | Include open-source license compliance scanning (trivy) | `false` |
| `--sbom` | Generate CycloneDX SBOM inventory to stdout (requires trivy) | `false` |
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

# Scan specific files only (useful for agents scanning just what they changed)
fast-cv --only="src/api/routes.py" .
fast-cv --only="src/**/*.js,lib/**/*.ts" .

# Auto-fix formatting/style issues, then report remaining problems
fast-cv --fix .
fast-cv --fix --only="src/utils.py" .

# Output SARIF format (for CI/CD integration)
fast-cv --format sarif .
fast-cv --format sarif . | jq .

# Auto-install any missing tools, then scan
fast-cv . --auto-install

# 30-second timeout per tool, verbose
fast-cv . --timeout 30 -v

# Exclude extra directories/files (gitignore pattern syntax)
fast-cv . --exclude ".svelte-kit/,config.js,**/generated/"
fast-cv . -x "storybook-static/,*.config.js"

# Run only specific tools
fast-cv --tools=jscpd .
fast-cv --tools=trivy .
fast-cv --tools=mypy .
fast-cv --tools=typos .         # opt-in tool: only runs when explicitly requested
fast-cv --tools=vulture .       # dead code detection for Python
fast-cv --tools=knip .          # dead code detection for JS/TS

# License compliance scanning
fast-cv --licenses .
fast-cv --licenses --tools=trivy .

# Generate CycloneDX SBOM
fast-cv --sbom . > sbom.json
```

## `--only` Flag

The `--only` flag restricts scanning to specific files. It accepts both exact paths and glob patterns, comma-separated:

```bash
fast-cv --only="src/api/routes.py" .                    # exact file
fast-cv --only="src/**/*.py" .                           # glob pattern
fast-cv --only="src/api/routes.py,src/api/models.py" .  # multiple files
fast-cv --only="src/**/*.js,lib/**/*.ts" .               # multiple globs
```

Filtering happens at three levels for maximum efficiency:

1. **Pruner level**: File discovery is narrowed to matching files only, so language detection is accurate.
2. **Tool level**: When possible, matching file paths are passed directly to tools as arguments instead of the whole directory (ruff, eslint, semgrep, bearer, mypy, typos). Cross-file tools like jscpd, trivy, and module-scoped tools like golangci-lint still scan the full directory.
3. **Post-filter level**: As a safety net, findings outside the `--only` set are stripped from the report. This catches any results from tools that must scan broader than the file list.

## `--fix` Flag

The `--fix` flag tells tools to auto-fix formatting and style issues before reporting remaining problems:

```bash
fast-cv --fix .
fast-cv --fix --only="src/utils.py" .
```

Fix support varies by tool:

| Tool | Fix behavior |
|------|-------------|
| **ruff** | Two-step: runs `ruff format` first (whitespace, quotes, imports), then `ruff check --fix` (safe auto-fixes). Reports remaining issues. Includes pydocstyle `D` rules for docstring checks. |
| **eslint** | Adds `--fix` to the scan command. Applies fixes and reports remaining in one pass. |
| **golangci-lint** | Adds `--fix` to the scan command (limited support). |
| **semgrep** | No fix capability. Runs and reports normally. |
| **bearer** | No fix capability. Runs and reports normally. |
| **jscpd** | No fix capability. Runs and reports normally. |
| **trivy** | No fix capability. Scans for vulnerabilities, misconfigs, and secrets. |
| **mypy** | No fix capability. Reports type errors only. |
| **typos** | No fix capability. Reports spelling mistakes. |
| **vulture** | No fix capability. Reports dead code in Python. |
| **knip** | No fix capability. Reports unused files, exports, and dependencies in JS/TS. |

When `--fix` is active, the report header shows `**Mode**: fix`.

## SARIF Output

fast-cv supports [SARIF 2.1.0](https://sarifweb.azurewebsites.net/) output for integration with CI/CD systems:

```bash
# Output SARIF to stdout
fast-cv --format sarif .

# Pipe to a file for GitHub Code Scanning
fast-cv --format sarif . > results.sarif

# Validate with jq
fast-cv --format sarif . | jq '.runs[0].results | length'
```

SARIF output includes rule deduplication, tag-to-level mapping (error/warning/note), source tool attribution, and run-level metadata (duration, warnings, fix mode).

## `install-hook` Command

Install a git pre-commit hook that runs fast-cv before each commit:

```bash
# Install hook in current directory
fast-cv install-hook

# Install hook in a specific project
fast-cv install-hook /path/to/project

# Overwrite existing pre-commit hook
fast-cv install-hook --force
```

The hook runs `fast-cv . --timeout 60` and blocks the commit if issues are found. To bypass the hook temporarily:

```bash
git commit --no-verify
```

## Output Format

fast-cv produces tagged Markdown grouped by file:

```markdown
# fast-cv report

**Target**: `/path/to/project`
**Date**: 2026-02-23T18:30:00Z
**Tools**: ruff (0.4s), eslint (1.1s), semgrep (3.2s), trivy (2.1s), mypy (1.5s), typos (0.3s), jscpd (0.8s)

---

## Findings (14 issues)

### `src/auth/login.py`

- **[SECURITY]** `S105` Hardcoded password detected (line 42)
- **[TYPE_ERROR]** `arg-type` Argument 1 has incompatible type "str"; expected "int" (line 28, col 5)
- **[DOCS]** `D103` Missing docstring in public function (line 10)
- **[LINTER]** `F401` `os` imported but unused (line 1)
- **[FORMAT]** `E302` Expected 2 blank lines, found 1 (line 15)

### `requirements.txt`

- **[DEPENDENCY]** `CVE-2023-1234` Vulnerable dependency: requests@2.28.0 has CVE-2023-1234 (HIGH). Upgrade to 2.31.0. HTTP redirect handling vulnerability (line 0)

### `Dockerfile`

- **[INFRA]** `DS001` Running as root user (line 5)
- **[SECRET]** `aws-access-key-id` AWS: AWS Access Key ID (match: AKIA1234...) (line 12)

### `src/utils/helpers.js`

- **[TYPO]** `typo` "teh" → the (line 42)
- **[DUPLICATION]** `jscpd/javascript` Duplicated block (20 lines, 100 tokens) — also in src/api/handler.js:45 (line 10)

### `package-lock.json`

- **[LICENSE]** `GPL-3.0` Restrictive license: some-gpl-lib uses GPL-3.0 (HIGH). Consider replacing with an MIT/Apache-2.0 alternative (line 0)

### `src/old_parser.py`

- **[DEAD_CODE]** `vulture/unused` unused function 'parse_legacy_format' (90% confidence) (line 42)

---

*16 findings from 9 tools in 7.4s*
```

### Tags

| Tag | Meaning |
|-----|---------|
| `[SECURITY]` | Security vulnerability or risky pattern |
| `[BUG]` | Likely bug or correctness issue |
| `[REFACTOR]` | Complexity, maintainability, or code smell |
| `[LINTER]` | General lint rule violation |
| `[FORMAT]` | Formatting or style issue |
| `[PRIVACY]` | Data privacy or data-flow concern |
| `[DUPLICATION]` | Duplicated code block |
| `[DEPENDENCY]` | Vulnerable dependency (CVE in lockfile) |
| `[INFRA]` | Infrastructure misconfiguration (Dockerfile, Compose, Terraform) |
| `[SECRET]` | Hardcoded secret or credential in source code |
| `[TYPE_ERROR]` | Static type error (incompatible types, missing attributes) |
| `[DOCS]` | Missing or malformed documentation (docstrings, JSDoc) |
| `[TYPO]` | Spelling mistake in identifiers or comments |
| `[LICENSE]` | Restrictive open-source license in dependency |
| `[DEAD_CODE]` | Unused function, variable, file, export, or dependency |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Clean — no findings |
| `1` | Findings exist |
| `2` | Precheck failed (missing tools) |

## Configuration

fast-cv resolves configs with a fallback chain (first match wins):

1. **Local**: Config file or directory in the scanned directory (e.g., `ruff.toml`, `eslint.config.js`, `.semgrep/`, `trivy.yaml`, `mypy.ini`, `typos.toml`)
2. **User default**: `~/.config/fast-cv/defaults/<file-or-dir>`
3. **Package default**: Shipped baseline configs in `defaults/`
4. **None**: Tool uses its own built-in defaults

### Default Config Highlights

**semgrep** ships as a config directory (`defaults/semgrep/`) containing custom taint rules (`taint.yaml`) and the OWASP Top 10 ruleset (`owasp-top-ten.yaml`, ~543 rules downloaded during install). Semgrep reads all YAML files in the directory, giving ~549 rules total — fully offline after install.

**ruff** ships with pydocstyle (`D`) rules enabled for docstring validation, with targeted ignores for overly-noisy rules (`D100`, `D104`, `D105`, `D107`). Test files are exempt from `D` rules.

**eslint** ships with [eslint-plugin-sonarjs](https://github.com/SonarSource/eslint-plugin-sonarjs) enabled, providing cognitive complexity analysis, duplicate string detection, and code smell rules on top of the standard security and quality checks.

**golangci-lint** enables `gocognit` and `gocritic` linters by default when no local `.golangci.yml` config is found, adding cognitive complexity analysis and opinionated code checks for Go.

**mypy** ships with `ignore_missing_imports = True` and `check_untyped_defs = True` to balance thoroughness with noise reduction.

### Ignoring Files

fast-cv applies ignore rules at **two levels**:

1. **File discovery** — ignored paths are excluded from language detection and file counting.
2. **Finding post-filter** — findings reported by tools (which scan the full directory independently) are filtered through the same ignore rules before the report is generated.

This means `.svelte-kit/`, `node_modules/`, `dist/`, and other build artifacts are stripped from the report even when a tool scans them internally.

Ignore sources (merged together, first match wins):

- **Hardcoded**: `node_modules`, `__pycache__`, `.venv`, `dist`, `build`, `.svelte-kit`, `.next`, `.nuxt`, and [many more](src/pruner.js) common build/cache directories, plus lock files (`package-lock.json`, `yarn.lock`, etc.)
- **`.gitignore`**: Patterns from the target directory's `.gitignore`
- **`.fcvignore`**: Project-specific overrides (same syntax as `.gitignore`)
- **`--exclude`**: CLI flag for ad-hoc patterns (e.g., `-x "admin/captive/,*.config.js"`)

## Inline Suppression

When a finding is intentional (e.g. a webhook field name dictated by an external API), suppress it inline:

| Tool | Suppress syntax |
|------|----------------|
| **ruff** | `# noqa: E501` (specific rule) or `# noqa` (all rules on line) |
| **eslint** | `// eslint-disable-next-line no-eval` |
| **semgrep** | `// nosemgrep: rule-id` or `# nosemgrep` |
| **mypy** | `# type: ignore[error-code]` |
| **typos** | `// typos:disable-next-line` or `# typos:disable-next-line` |
| **golangci-lint** | `//nolint:lintername` |
| **bearer** | `// bearer:disable rule_id` |

These comments are understood natively by each tool — fast-cv does not strip or process them.

## Development

```bash
# Run tests
npm test

# Run a specific test file
node --test test/pruner.test.js

# Self-scan
node bin/fast-cv.js .

# Test --only flag
node bin/fast-cv.js --only="src/tools/eslint.js" .

# Test --fix flag
node bin/fast-cv.js --fix --only="src/tools/eslint.js" .

# Test SARIF output
node bin/fast-cv.js --format sarif .

# Test install-hook
node bin/fast-cv.js install-hook .

# Test specific tools
node bin/fast-cv.js --tools=jscpd .
node bin/fast-cv.js --tools=trivy .
node bin/fast-cv.js --tools=mypy .
node bin/fast-cv.js --tools=typos .
node bin/fast-cv.js --tools=vulture .
node bin/fast-cv.js --tools=knip .

# Test license scanning
node bin/fast-cv.js --licenses --tools=trivy .

# Generate SBOM
node bin/fast-cv.js --sbom . | python3 -m json.tool
```

## License

MIT
