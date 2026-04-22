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
| docspec | `docspec.json`, `.docspec.json` | `defaults/docspec.json` |
| spectral | `.spectral.yaml`, `.spectral.yml`, `.spectral.json`, `.spectral.js` | `defaults/.spectral.yaml` |
| markdownlint | `.markdownlint.json`, `.markdownlint.yaml`, `.markdownlint.yml`, `.markdownlint-cli2.jsonc`, `.markdownlint-cli2.yaml` | `defaults/.markdownlint.json` |
| vale | `.vale.ini`, `vale.ini` | `defaults/.vale.ini` (styles synced via `vale sync`) |

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

### `defaults/docspec.json`
- `maxFileBytes: 2000000` — skip files larger than 2 MB
- `remoteRefs.enabled: true` — fetch remote `$ref` with a 5s timeout, 1 MB size cap, 64-fetches-per-file limit, 24h local cache
- `remoteRefs.allowlist: null` — accept all remote hosts (set to a string array of URL prefixes to lock it down)
- `forceType: {}` — glob → `openapi | swagger | asyncapi | jsonschema | none` overrides for ambiguous files

### `defaults/.spectral.yaml`
- Extends `spectral:oas` + `spectral:asyncapi` recommended rulesets
- Promotes `info-contact`, `no-$ref-siblings`, `oas3-valid-media-example` to `error`
- Downgrades `operation-operationId`, `operation-tags`, `info-description` to `warn`
- Disables `no-unused-components`
- Loosens rules under `**/test/**`, `**/fixtures/**`, `**/generated/**`
- `resolver.resolveRef: true` (remote ref resolution — set to `false` for offline-only)

### `defaults/.markdownlint.json`
- Enables `default: true`
- Disables `MD013` (line length), `MD033` (raw HTML), `MD041` (first-line H1)
- `MD024` allows duplicate headings in sibling sections

### `defaults/.vale.ini`
- Style packages: `write-good`, `proselint`
- Applies to `.md`, `.markdown`, `.rst`, `.adoc`, `.txt`
- `MinAlertLevel = suggestion`
- `installer.sh` runs `vale sync` after copying this file so the style bundles live alongside it under `~/.config/fast-cv/defaults/vale-styles/`

## Documentation Validation

fast-cv ships four cooperating tools for validating documentation. All emit under the `DOCS` tag; the `rule` field identifies the subtype (`openapi/*`, `swagger/*`, `asyncapi/*`, `jsonschema/*`, `docspec/parse`, `spectral/<ruleId>`, `md/<ruleId>`, `vale/<Check>`).

| Tool | What it catches | External binary |
|------|-----------------|-----------------|
| `docspec` | YAML/JSON parse errors, structural sanity of OpenAPI 3.x / Swagger 2.0 / AsyncAPI 2.x-3.x / JSON Schema specs, remote `$ref` reachability | none — pure Node |
| `spectral` | Full spec conformance per `spectral:oas` + `spectral:asyncapi` rulesets | `spectral` (installed by `install.sh`) |
| `markdownlint` | Markdown structure and style issues | `markdownlint-cli2` (installed by `install.sh`) |
| `vale` | Prose style (weasel words, passive voice, typography) | `vale` (installed by `install.sh`) |

### Detection (`docspec`)

`docspec` classifies only on strong signals and silently ignores non-spec YAML/JSON. A file is classified when:

| Format | Required root keys |
|--------|--------------------|
| OpenAPI | `openapi` is a string matching `^3\.\d+(\.\d+)?$` AND `info` is an object |
| Swagger | `swagger` is `"2.0"` / `2` / any `N.N` string AND `info` is an object |
| AsyncAPI | `asyncapi` is a `2.x` or `3.x` semver string AND `info` is an object |
| JSON Schema | `$schema` is a string (any draft) OR filename matches `*.schema.json` with a schema-like shape |

Override per glob in `docspec.json` via `forceType: { "api/**/*.yml": "openapi", "legacy.json": "none" }`.

### Remote `$ref` Safety

When `docspec` encounters a remote `$ref` (`http://...` or `https://...`), it:

1. Checks the per-file allowlist; blocked URLs emit `<format>/ref-remote-blocked` warnings.
2. Checks a local 24h cache under `remoteRefs.cacheDir` (default `~/.cache/fast-cv/refs`). Cache can be busted with `--update-db`.
3. Fetches with a 5s timeout and streaming 1 MB size cap; failures emit `<format>/remote-ref-unreachable` warnings.
4. Stops fetching once the per-file budget (`maxFetchesPerFile`, default 64) is exhausted.

Set `remoteRefs.enabled: false` in `docspec.json` to block all remote fetches; every remote `$ref` in-scope then emits a `<format>/remote-ref-disabled` warning.

Spectral's own resolver also honors `resolver.resolveRef` in `.spectral.yaml`; set it to `false` for fully offline runs.

### Fix Behavior

- `docspec --fix` applies only whitelisted, byte-preserving edits: leading-slash injection for OpenAPI path keys, string-quoting for `swagger: 2.0` (number → `"2.0"`).
- `spectral --fix` invokes `redocly bundle <file> --output <file>` (if `redocly` is installed) to resolve refs and normalize structure before re-linting.
- `markdownlint --fix` runs the tool's native autofix.
- `vale` has no fix mode — findings are suggestions only.

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
| `-t, --timeout <seconds>` | disabled | Optional per-tool timeout guardrail |
| `--tools <names>` | all applicable | Comma-separated tool list |
| `-v, --verbose` | `false` | Show detailed output on stderr |
| `--auto-install` | `false` | Auto-install missing tools |
| `-x, --exclude <patterns>` | — | Comma-separated ignore patterns |
| `--only <patterns>` | — | Scan only matching files/globs |
| `--fix` | `false` | Run only fix-capable tools, apply fixes, and exit (no findings report; see Fix Safety below) |
| `--licenses` | `false` | Include license compliance scanning (trivy) |
| `--update-db` | `false` | Refresh external scanner databases before scanning (currently trivy) |
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

### Tool Errors and Exit Codes

Tool runtime failures are reported separately from code findings. Missing tools remain warnings when at least one applicable tool can run, but a selected tool that errors, times out, or produces unparseable output makes validation incomplete and exits `2`. Trivy database cache failures include guidance to run `fast-cv --update-db .` or rerun `install.sh --mode all`.

| Code | Meaning |
|------|---------|
| `0` | Clean — no findings and all selected tools completed |
| `1` | Code findings exist |
| `2` | Bad target, precheck failure, tool runtime error, timeout, parse error, or stale/missing scanner database |

### Subcommands

| Command | Description |
|---------|-------------|
| `fast-cv install-hook [dir]` | Install git pre-commit hook |
| `fast-cv install-hook --force` | Overwrite existing hook |
