# fast-cv

Fast Code Validation — sequential linters & security scanners with unified Markdown/SARIF reports.
Node.js ESM, v0.2.1, 3 dependencies, zero build step.

## Commands

```bash
npm test                              # all tests (node --test)
node bin/fast-cv.js --tools=eslint .  # self-scan (JS only, fast)
node bin/fast-cv.js .                 # full scan
node bin/fast-cv.js --fix .           # run only fixers, apply fixes, exit (no report; formatting only with shipped defaults)
node bin/fast-cv.js --format sarif .  # SARIF output
node bin/fast-cv.js --git-only .      # scan only git-changed files (uncommitted + unpushed)
node bin/fast-cv.js --git-only=uncommitted . # scan only uncommitted changes
node bin/fast-cv.js --max-lines=400 . # custom file length threshold
node bin/fast-cv.js --max-lines=0 .   # disable file length check
node bin/fast-cv.js --no-docstring .  # suppress DOCS tag findings
```

## Architecture

12-step pipeline: CLI parse → git-only resolution → prune → filter tools → precheck → resolve configs → sequential run → line-check → post-filter → docstring filter → format → output + exit code.

| File | Role |
|------|------|
| `src/index.js` | CLI + pipeline orchestration |
| `src/pruner.js` | File discovery, ignore/only filtering |
| `src/precheck.js` | Tool installation checks |
| `src/config-resolver.js` | Config resolution (local → user → package → none) |
| `src/runner.js` | Sequential execution with optional timeout + verbose progress |
| `src/normalizer.js` | Markdown report + post-filter |
| `src/sarif.js` | SARIF 2.1.0 output |
| `src/findings.js` | Shared finding collection helper |
| `src/constants.js` | Shared constants and JSON Lines parser |
| `src/line-check.js` | Built-in file length checker |
| `src/git-changes.js` | Git-changed file detection |
| `src/tools/*.js` | One adapter per tool |
| `defaults/` | Shipped configs (ruff, eslint, mypy, semgrep, stylelint, golangci-lint) |

## Code Conventions

- **ESM only** — `import`/`export`, never `require()`
- **No build step** — run directly with `node`
- **Native test runner** — `node:test` + `node:assert/strict`
- **3 deps only** — commander, ignore, yaml
- **Tool adapter pattern** — each tool exports `{ name, extensions, buildCommand, parseOutput, checkInstalled, installHint }` (optional: `optIn`, `supportsFix`, `preFixCommands`)
- **Findings shape** — `{ file, line, col?, tag, rule, severity, message }`

## Tags

SECURITY BUG PRIVACY SECRET LICENSE DEPENDENCY INFRA TYPE_ERROR LINTER REFACTOR DOCS TYPO DEAD_CODE FORMAT DUPLICATION

Canonical source: [docs/tools.md](docs/tools.md)

## Definition of Done

Every change must satisfy:

1. `npm test` passes
2. `node bin/fast-cv.js --tools=eslint .` exits clean (exit code 0)
3. New tools: adapter in `src/tools/` + test in `test/tools/` + entry in `src/tools/index.js`
4. New configs: registered in `src/config-resolver.js` + shipped in `defaults/`

## Don't

- Add a build step (webpack, tsc, rollup)
- Add dependencies beyond commander/ignore/yaml
- Use `require()` or CommonJS
- Use Jest, Mocha, or other test frameworks
- Create `.d.ts` files or TypeScript source
- Add runtime transpilation
- Bump npm runtime deps just to stay on latest — see Dependency Policy below

## Dependency Policy

Runtime npm deps (`commander`, `ignore`, `yaml`) are bumped **only** when:

1. `npm audit` reports a vulnerability at the configured severity, or
2. A feature/fix requires an API only available in the newer version.

Being "behind latest" is not a reason to bump. CI runs `npm audit --audit-level=high` on every PR (`.github/workflows/test.yml`), which is the continuous signal — if it turns red, treat that as the trigger to upgrade as a focused, scoped change. Do not bundle "stay current" bumps into unrelated PRs.

## Deep Context

- [docs/architecture.md](docs/architecture.md) — pipeline, data flow, data contracts, security model
- [docs/tools.md](docs/tools.md) — adapter interface, all 19 tools, tag reference
- [docs/configuration.md](docs/configuration.md) — config resolution, defaults, ignore system, CLI flags
- [docs/testing.md](docs/testing.md) — test patterns, conventions, how to add tests
