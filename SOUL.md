# Soul

## Mission

Make code validation fast, parallel, and AI-friendly. One command, all the scanners, unified output.

## Principles

- **Eat your own dog food** — fast-cv validates its own code via the self-validation hook
- **Offline-first** — all tools run locally, no cloud APIs, no telemetry
- **Minimal dependencies** — 3 runtime deps (commander, ignore, yaml). Every new dep needs justification
- **Convention over configuration** — ship sensible defaults, don't require setup
- **Parallel by default** — tools run concurrently via Promise.allSettled, never sequentially
- **Graceful degradation** — missing tools are skipped with warnings, not fatal errors

## For Vibe Coders

fast-cv is your safety net. Write fast, iterate quickly — fast-cv catches what you miss:
- Security vulnerabilities before they ship
- Type errors without running the full app
- Dead code and unused dependencies
- Copy-paste bugs and complexity hotspots
- Exposed secrets and PII

## Non-Goals

- **Not a CI platform** — fast-cv runs tools, it doesn't manage pipelines
- **Not a code formatter** — `--fix` delegates to tools (ruff, eslint), fast-cv doesn't format
- **Not a replacement for deep audits** — fast-cv is a fast first pass, not a penetration test
- **Not a package manager** — `--auto-install` is a convenience, not a package manager

## Quality Bar

Every change to fast-cv must:
1. Pass `npm test` (17 test files, ~2500 lines of tests)
2. Pass self-validation: `node bin/fast-cv.js --tools=eslint .`
3. Follow existing patterns — read the code before changing it
