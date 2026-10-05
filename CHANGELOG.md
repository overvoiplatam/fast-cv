# Changelog

All notable changes to fast-cv are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — golangci-lint v2 support (adapted from local work, standardized)

- `golangci-lint` v2 support in the adapter: `checkInstalled()` detects the major from `--version` output (exposed as the `detectedMajor` property, settable by tests), `buildCommand` uses v2's `--output.json.path stdout` (v1 keeps `--out-format json`), and v2's trailing summary line (`"0 issues."`) after the JSON document is handled by parsing the first balanced JSON object.
- `defaults/.golangci.yml` now targets the v2 schema (`version: "2"`, nested `linters.settings`), verified against golangci-lint 2.10.1 (`config verify`). golangci-lint v1 rejects this schema — v1 users should provide a local config (local wins over shipped defaults in resolution order).
- `knip` skips targets without a `package.json` (not a JS project) with a reported note instead of a misleading bootstrap-failure finding; run-time skips now surface in the report's `[WARN]` section (`result.skipped` was previously recorded by the runner but never displayed).
- New shared module `src/adapter-helpers.js` with `parseLeadingJson` (first balanced JSON object, junk-aware), `majorFromVersion` (version-line → major), `skipUnlessFileExists` (project-root skip factory) and `resolveReportedPath` (recovers findings filenames that some tools relativize against a base of their own choosing — golangci-lint v2 was observed emitting paths relative to /tmp while its cwd was the target, breaking the ignore-path contract downstream). Each helper carries its own unit tests.

### Fixed — Svelte/Vue lint lanes (they crashed or silently never ran)

- `.svelte` and `.vue` files were effectively never linted by the shipped default config: `eslint-plugin-svelte` cannot even import without the `svelte` compiler (its npm peer), `eslint-plugin-vue` cannot parse without `vue-eslint-parser`, and `eslint-plugin-svelte` does a runtime `import("eslint")` no global eslint binary satisfies — none of these peers are auto-installed under the `--legacy-peer-deps` install path. `install.sh` now ships all of them (`eslint`, `svelte`, `vue-eslint-parser` added to `CONFIG_PEERS`) and the CI self-scan batch pins them.
- `svelte-eslint-parser@1.8.x` still bundles `eslint-scope 8.4.0`, whose `ScopeManager` lacks `addGlobals()` — which the eslint@10 language core calls on every source verification — crashing the first scanned `.svelte` file with `TypeError: scopeManager.addGlobals is not a function` (eslint@9 does not make that call, so the pair works there). The default config now introspects the installed parser's own eslint-scope the way the parser resolves it and keeps svelte rules off, with a `[WARN]` in the report, until the parser ships eslint-scope 9.x.
- The svelte/vue parsers resolve `eslint-scope`/`espree` from the scanned project's cwd, falling back to global node paths; on distro-managed hosts that fallback hits stub packages exposing non-semver versions (`/usr/share/nodejs/eslint-scope` reports version `"main"`), producing `semver: Invalid Version: main` parse errors. The config probes exactly what the parsers probe and degrades with an actionable `[WARN]` instead.
- eslint degradation notices printed by the shipped config (missing extras, disabled framework rules) now surface in the report's `[WARN]` section instead of being swallowed with the tool's stderr.
- README Language Coverage now lists Svelte and Vue rows.

### Changed — License & packaging compliance

- **`eslint-plugin-sonarjs` (LGPL-3.0) and `eslint-plugin-security` (Apache-2.0) moved from `dependencies` to `devDependencies`.** The production graph is now 100% permissive (commander MIT, ignore MIT, yaml ISC) — nobody installing fast-cv pulls LGPL code into their tree unless they opt in. The extras still activate automatically wherever they are present: `install.sh --mode all/app` installs them (`CONFIG_PEERS`), `npm install` inside the repo pulls them, and the default eslint config prints a stderr note with the exact install command when they are missing.
- devDependencies bumped to the eslint-9/10-compatible majors: `eslint-plugin-sonarjs@^4.2.2` (dropped its `@babel/eslint-parser` dep that pinned the local eslint to 8.x) and `eslint-plugin-security@^4.2.0` (no eslint peer at all). The CI self-scan batch now pins the remaining plugins to their current majors so an upstream peer bump can no longer break resolution against whatever eslint the devDep tree pulled in.
- New CI job `license gate (production deps)`: `license-checker --production --failOn GPL;LGPL;AGPL;EUPL;SISSL;CPOL` fails the build if a runtime dependency ever introduces copyleft.
- Added `THIRD_PARTY_NOTICES.md` — consolidated third-party index (vendored vale styles: proselint BSD-3-Clause, write-good MIT; both attribution files already shipped in each style directory).

### Fixed

- Findings on `package-lock.json` and other generated lock files are now filtered the way they were always documented: jscpd duplicate-block findings inside them are dropped (generated segments legitimately repeat), while single-file findings from independent scanners (trivy CVE/dependency/`--licenses`) are preserved — they were never supposed to be filtered and still aren't.

## [0.3.0] - 2026-10-03

### Added — Documentation Validation (default feature)

- Four new tool adapters, all emitting under the `DOCS` tag:
  - `docspec` — pure-Node validator for OpenAPI 3.x, Swagger 2.0, AsyncAPI 2.x/3.x, and JSON Schema documents. Classifies files by strong root-key signals, reports parse errors and structural-sanity issues (missing `info.title`, wrong version format, path keys without a leading slash, non-object `properties`, etc.), and resolves `$ref` (local + remote) with a 5s timeout, 1 MB size cap, 24h cache, and optional allowlist.
  - `spectral` — wraps `@stoplight/spectral-cli` with a shipped ruleset extending `spectral:oas` + `spectral:asyncapi` recommended, per-rule severity tuning, and `resolver.resolveRef: true` for remote ref resolution. `--fix` mode invokes `redocly bundle` as a pre-fix command when `redocly` is installed.
  - `markdownlint` — wraps `markdownlint-cli2` with a shipped ruleset (disables MD013/MD033/MD041, allows duplicate headings in sibling sections). Supports native `--fix`.
  - `vale` — wraps `vale` with a shipped `.vale.ini` using `write-good` + `proselint` style packages. `install.sh` runs `vale sync` to populate styles under `~/.config/fast-cv/defaults/vale-styles/`.
- `install.sh --mode all` now provisions `@stoplight/spectral-cli`, `@redocly/cli`, `markdownlint-cli2`, and `vale` (via brew → `go install` → GitHub release fallback).
- `docspec.json`, `.spectral.yaml`, `.markdownlint.json`, `.vale.ini` ship under `defaults/` and copy into `~/.config/fast-cv/defaults/` during `--mode all` or `--mode configs`.
- `docspec` supports `--fix` with a safe whitelist: prepends `/` to OpenAPI path keys missing it; quotes numeric `swagger: 2.0` as `"2.0"`.

### Added — JSON file `--fix` support

- `knip` now supports `--fix`. When invoked in fix mode, knip prunes unused exports, files, and dependencies from `package.json` in place. **Destructive**: review the diff before committing — knip removes code based on its dead-code heuristic and can mis-identify dynamically-referenced exports.
- `eslint-plugin-jsonc` is now installed by `install.sh --mode all` and pre-wired in `defaults/eslint.config.mjs`, so `eslint` lints `.json` and `.jsonc` files (including `package.json`, `tsconfig.json`). For `--fix` on JSON, a **local** `eslint.config.{js,mjs,cjs}` is still required — the shipped defaults are gated by the package-default fix policy. See [docs/configuration.md](docs/configuration.md) → "JSON files specifically" for details.

### Breaking

- **`--timeout` is now optional and disabled by default.** Previously, `fast-cv` imposed a 120-second guardrail on every tool. The guardrail is now off unless you pass `--timeout <seconds>` explicitly. Tools without their own internal timeout can, in theory, hang indefinitely.
  - *Upgrade note:* if you relied on the implicit 120s guardrail (e.g. in CI), pass `--timeout 120` explicitly.
- **`knip` now requires a global install.** The adapter shells out to `knip` directly instead of invoking `npx knip`.
  - *Upgrade note:* run `npm install -g knip`, or re-run `./install.sh --mode all` which provisions it for you.
- **Pre-commit hook script no longer passes `--timeout 60`.** Regenerating the hook via `fast-cv install-hook --force` writes `fast-cv .` without any timeout.
  - *Upgrade note:* re-run `fast-cv install-hook --force` to pick up the new body. If you want the 60-second guardrail back, edit the generated `.git/hooks/pre-commit` and re-add `--timeout 60`.
- **Degraded environments now fail loudly (exit code 2) instead of reporting a clean scan.**
  - If `--auto-install` cannot make *any* tool ready, the precheck fails with exit 2. Previously the run printed "No issues found" and exited 0 while leaving every scanner unrun.
  - semgrep exiting non-zero with a stderr message and no parseable `results` array (e.g. a `--config auto` network/config failure) is now a tool error. Previously it was silently reported as an empty, clean scan.
  - *Upgrade note:* CI without network or tool access fails red where it used to pass green-but-useless. Keep runner environments provisioned (`install.sh --mode all`) or scope the failing tool with `--tools`.
- **Invalid flag values are usage errors (exit 2), not silent fallbacks.**
  - `--max-lines abc` previously produced a `NaN` that silently disabled the file-length check; it now exits 2 with a clear message. `--max-lines 0` remains the documented disable value.
- **Unknown `--git-only` values keep the 0.2.1 behavior, but now warn.** Commander folds the positional target into the optional `[scope]`, so documented invocations like `--git-only .` were treated as the uncommitted scope all along; that mapping (and what it scans) is preserved byte-for-byte, with a stderr warning suggesting the explicit `--git-only=all` / `--git-only=uncommitted` forms. Bare `--git-only` still scans uncommitted + unpushed.

### Added — Agent-native output and scan scoping

- `--format json`: compact, deterministic JSON report (`{target, summary, findings, toolErrors, warnings}`), optimized for AI-agent consumption alongside the existing markdown and SARIF formats.
- `--min-severity <level>`: `--min-severity error` filters everything below `error` severity (SECURITY, BUG, PRIVACY, SECRET, LICENSE); the exit code, markdown header, and JSON summary all agree on what a "finding" is. The default (`warning`) keeps the full report unchanged.
- `--git-only` gains an explicit `uncommitted` scope (working tree only). The bare flag keeps the 0.2.1 default — uncommitted + unpushed — so existing scripts, hooks, and CI scan the same files as before.

### Added

- `--update-db` flag that lets tools with external databases refresh them before scanning. Currently wired to trivy — when omitted, trivy runs with `--offline-scan --skip-db-update --skip-java-db-update --skip-check-update --skip-vex-repo-update` for repeatable offline scans.
- Trivy SBOM generation (`--sbom`) respects `--update-db` the same way and emits actionable stderr advice ("run with `--update-db --sbom .`") when the database cache appears stale.
- **Tool Errors section** in the Markdown report: tools that fail to run (crash, parse error, timeout) are listed separately from findings so they are not silently lost.
- Tool errors are exposed in SARIF output under `runs[].properties.toolErrors`.
- `getScanExitCode(results)` is now exported from `src/index.js`, centralising exit-code logic (2 on tool error, 1 on findings, 0 otherwise).
- `src/version.js` sources the CLI version from `package.json` at import time, so future bumps only need a single edit.
- `install.sh --mode all` now provisions `knip`, `typescript` (for `tsc`), `clippy` (via rustup), and pre-warms the trivy vulnerability + Java databases so the first offline scan has a current baseline.
- Fix mode (`--fix`) now exits with code 2 when any fixer reports an error, matching scan-mode semantics.
- `examples/gitea-action.yml` gains commented examples showing `--timeout 300` and `--update-db --tools=trivy` usage.
- New test files: `test/index.test.js` (exit-code logic, hook script body, SBOM flag routing, VERSION) and `test/install-script.test.js` (installer provisions all supported tools).

### Changed

- Exit-code `2` now covers any reason validation could not complete: missing target, precheck failure, tool runtime error, timeout, parse error, or stale/missing scanner database. Previously it meant "precheck failed" only.
- Markdown report footer reads "*N findings from M completed tools in Ts*" and appends "`; K tool error(s)`" when applicable.
- SARIF `tool.driver.version` is now sourced from `package.json` (was hard-coded `0.2.0`, which drifted from the CLI's `0.2.1`).
- Unexpected internal rejections (e.g. `EACCES` while pruning) surface as a one-line `fast-cv: <message>` on stderr with exit 2, instead of an unhandled-rejection stack trace with exit 1.

### Fixed

- SARIF version field no longer drifts from the CLI version — both come from `package.json` via `src/version.js`.
- ruff findings now read the severity field ruff actually emits. The adapters were reading a `type` field that does not exist in ruff 0.16 JSON output, so every finding was silently mapped to `warning` — downgrading `SECURITY` rules in reports and filters.
- `git status` output is parsed byte-exactly via NUL separation (`--porcelain` `-z`): paths with spaces, quotes, or unicode, and rename destinations, are no longer truncated or misparsed. Files whose name merely *starts* with `..` (e.g. `..backup.js`) are no longer discarded as out-of-target, and the guard is separator-aware for Windows.
- The built-in line check no longer counts a file's trailing newline as an extra line.
- The tool runner clears its SIGTERM/SIGKILL escalation timers on exit — previously a delayed SIGKILL could land on a recycled PID if the process table reused the slot — and falls back to a direct kill on Windows, where process-group signalling is unavailable.
- Timeout handling in `src/runner.js` is now guarded with `Number.isFinite(opts.timeout) && opts.timeout > 0`, so `clearTimeout(null)` is never called when no timeout is configured.

## [0.2.1] and earlier

See `git log` for changes prior to the introduction of this changelog.

[Unreleased]: https://github.com/overvoiplatam/fast-cv/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/overvoiplatam/fast-cv/compare/v0.2.1...v0.3.0
