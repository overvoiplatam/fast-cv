# Changelog

All notable changes to fast-cv are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking

- **`--timeout` is now optional and disabled by default.** Previously, `fast-cv` imposed a 120-second guardrail on every tool. The guardrail is now off unless you pass `--timeout <seconds>` explicitly. Tools without their own internal timeout can, in theory, hang indefinitely.
  - *Upgrade note:* if you relied on the implicit 120s guardrail (e.g. in CI), pass `--timeout 120` explicitly.
- **`knip` now requires a global install.** The adapter shells out to `knip` directly instead of invoking `npx knip`.
  - *Upgrade note:* run `npm install -g knip`, or re-run `./install.sh --mode all` which provisions it for you.
- **Pre-commit hook script no longer passes `--timeout 60`.** Regenerating the hook via `fast-cv install-hook --force` writes `fast-cv .` without any timeout.
  - *Upgrade note:* re-run `fast-cv install-hook --force` to pick up the new body. If you want the 60-second guardrail back, edit the generated `.git/hooks/pre-commit` and re-add `--timeout 60`.

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

### Fixed

- SARIF version field no longer drifts from the CLI version — both come from `package.json` via `src/version.js`.
- Timeout handling in `src/runner.js` is now guarded with `Number.isFinite(opts.timeout) && opts.timeout > 0`, so `clearTimeout(null)` is never called when no timeout is configured.

## [0.2.1] and earlier

See `git log` for changes prior to the introduction of this changelog.

[Unreleased]: https://github.com/araai/fast-cv/compare/v0.2.1...HEAD
