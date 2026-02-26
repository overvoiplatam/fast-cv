# fast-cv

Fast Code Validation — sequential linters & security scanners with unified Markdown/SARIF reports.
Node.js ESM, v0.2.0, 3 dependencies, zero build step.

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

| File | Lines | Role |
|------|------:|------|
| `src/index.js` | 247 | CLI + pipeline orchestration |
| `src/pruner.js` | 175 | File discovery, ignore/only filtering |
| `src/precheck.js` | 110 | Tool installation checks |
| `src/config-resolver.js` | 84 | Config resolution (local → user → package → none) |
| `src/runner.js` | 143 | Sequential execution with verbose progress |
| `src/normalizer.js` | 103 | Markdown report + post-filter |
| `src/sarif.js` | 97 | SARIF 2.1.0 output |
| `src/findings.js` | 15 | Shared finding collection helper |
| `src/constants.js` | 29 | Shared constants and JSON Lines parser |
| `src/line-check.js` | 42 | Built-in file length checker |
| `src/git-changes.js` | 74 | Git-changed file detection |
| `src/tools/*.js` | 15 files | One adapter per tool |
| `defaults/` | dir | Shipped configs (ruff, eslint, mypy, semgrep, stylelint, golangci-lint) |

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

1. `npm test` passes (all 23 test files)
2. `node bin/fast-cv.js .` exits clean (exit code 0)
3. New tools: adapter in `src/tools/` + test in `test/tools/` + entry in `src/tools/index.js`
4. New configs: registered in `src/config-resolver.js` + shipped in `defaults/`

## Don't

- Add a build step (webpack, tsc, rollup)
- Add dependencies beyond commander/ignore/yaml
- Use `require()` or CommonJS
- Use Jest, Mocha, or other test frameworks
- Create `.d.ts` files or TypeScript source
- Add runtime transpilation

## Deep Context

- [docs/architecture.md](docs/architecture.md) — pipeline, data flow, data contracts, security model
- [docs/tools.md](docs/tools.md) — adapter interface, all 15 tools, tag reference
- [docs/configuration.md](docs/configuration.md) — config resolution, defaults, ignore system, CLI flags
- [docs/testing.md](docs/testing.md) — test patterns, conventions, how to add tests
