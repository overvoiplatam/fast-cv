# Architecture

Node.js ESM CLI that orchestrates linters and security scanners sequentially, outputting unified Markdown or SARIF reports. Zero build step, 3 runtime dependencies.

## File Map

| File | Purpose |
|------|---------|
| `bin/fast-cv.js` | Entry point — calls `run(process.argv)` |
| `src/index.js` | CLI definition, 12-step pipeline, `install-hook` subcommand |
| `src/pruner.js` | File discovery, ignore/only filtering, language detection |
| `src/precheck.js` | Tool installation verification and auto-install |
| `src/config-resolver.js` | Config resolution chain (local → user → package → none) |
| `src/runner.js` | Sequential tool execution with optional timeout + verbose progress |
| `src/normalizer.js` | Markdown report formatting + post-filter |
| `src/sarif.js` | SARIF 2.1.0 output formatting |
| `src/findings.js` | Shared finding collection helper |
| `src/constants.js` | Shared constants and JSON Lines parser |
| `src/line-check.js` | Built-in file length checker |
| `src/git-changes.js` | Git-changed file detection |
| `src/version.js` | Shared package version metadata |
| `src/tools/index.js` | Tool registry — exports all 19 adapters |
| `src/tools/ruff.js` | Python linter/formatter |
| `src/tools/eslint.js` | JavaScript/TypeScript linter |
| `src/tools/semgrep.js` | Multi-language SAST |
| `src/tools/bearer.js` | Privacy/PII scanner |
| `src/tools/golangci-lint.js` | Go linter |
| `src/tools/jscpd.js` | Copy-paste detector |
| `src/tools/trivy.js` | SCA + IaC + secrets + license scanner |
| `src/tools/mypy.js` | Python type checker |
| `src/tools/typos.js` | Typo finder (opt-in) |
| `src/tools/vulture.js` | Python dead code finder |
| `src/tools/knip.js` | JS/TS unused code finder |
| `src/tools/tsc.js` | TypeScript type checker |
| `src/tools/clippy.js` | Rust linter (clippy) |
| `src/tools/stylelint.js` | CSS/SCSS/Less linter |
| `src/tools/sqlfluff.js` | SQL linter |
| `src/tools/docspec.js` + `src/tools/docspec/` | Pure-Node OpenAPI/Swagger/AsyncAPI/JSON Schema validator (classify → validate → fix → resolve $ref) |
| `src/tools/spectral.js` | Spectral wrapper for full OAS/AsyncAPI/JSON Schema conformance |
| `src/tools/markdownlint.js` | markdownlint-cli2 wrapper (Markdown lint, native --fix) |
| `src/tools/vale.js` | Vale wrapper (prose style across .md/.rst/.adoc/.txt) |
| `defaults/` | Shipped baseline configs |
| `install.sh` | Full installer (modes: all, app, configs) |

## Pipeline (12 Steps)

```
src/index.js
```

1. **CLI Parse** (L18-38) — Commander parses flags and arguments
2. **Git-Only Resolution** (L88-104) — Resolve `--git-only` flag, detect changed files
3. **Prune Directory** (L107-108) — Walk tree, apply ignore rules, detect languages
4. **Filter Tools** (L116-136) — Match tools by language extensions + `--tools` flag
5. **Precheck** (L138-145) — Verify tools are installed (optional auto-install)
6. **Resolve Configs** (L147-153) — Find config for each tool (4-level chain)
7. **Sequential Run** — Run tools one at a time with optional timeout + verbose progress
8. **Line-Check** (L160-164) — Built-in file length checker
9. **Post-Filter** (L166-167) — Strip findings from ignored/excluded files
10. **Docstring Filter** (L169-173) — Suppress DOCS findings if `--no-docstring`
11. **Format + Output** (L175-181) — Generate Markdown or SARIF report, write to stdout
12. **Exit Code** — 0=clean, 1=findings, 2=validation/tool failure

## Data Flow

```
                ┌─────────────┐
  target dir ──>│   pruner    │──> files[], languages Set
                └─────────────┘
                      │
                ┌─────────────┐
  --tools ─────>│  filter +   │──> applicableTools[]
                │  precheck   │
                └─────────────┘
                      │
                ┌─────────────┐
  defaults/ ───>│   config    │──> toolConfigs[] ({tool, config})
                │  resolver   │
                └─────────────┘
                      │
                ┌─────────────┐
                │   runner    │──> ToolResult[]
                │(sequential) │
                └─────────────┘
                      │
                ┌─────────────┐
                │ normalizer  │──> Markdown or SARIF string
                │  / sarif    │
                └─────────────┘
                      │
                   stdout
```

## Data Contracts

### Finding

```javascript
{
  file: string,     // relative path
  line: number,     // 1-based
  col?: number,     // 1-based, optional
  tag: string,      // e.g. 'SECURITY', 'LINTER' — see docs/tools.md
  rule: string,     // tool-specific rule ID
  severity: string, // 'error' | 'warning'
  message: string   // human-readable description
}
```

### Tool Result

```javascript
{
  tool: string,        // adapter name
  findings: Finding[], // parsed findings
  error: string|null,  // error message or null
  duration: number     // milliseconds
}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Clean — no findings |
| 1 | Findings exist |
| 2 | Precheck failed (missing tools, bad directory) |

## Security Model

| Pillar | Tool | Tags |
|--------|------|------|
| SAST | semgrep | SECURITY, BUG |
| SCA | trivy | DEPENDENCY |
| IaC | trivy | INFRA |
| Secrets | trivy | SECRET |
| Privacy | bearer | PRIVACY |
| License | trivy | LICENSE |

## Key Design Decisions

- **Sequential execution** — tools run one at a time to avoid overwhelming low-resource machines; errors in one tool don't affect others
- **Timeout is opt-in** — no default guardrail. When `--timeout <seconds>` is passed, the runner sends SIGTERM and force-kills with SIGKILL after a 5-second grace period. Without the flag, tools run to completion under whatever internal timeouts they provide, keeping short-run jobs free of surprise cancellations but making a hanging tool visible (rather than auto-killed and silently marked failed)
- **Offline-first scanner databases** — trivy runs with `--offline-scan --skip-db-update --skip-java-db-update --skip-check-update --skip-vex-repo-update` by default so repeated scans are deterministic and do not depend on network availability. `--update-db` opts into a fresh download for that invocation; `install.sh --mode all` pre-warms the cache so first-time users start from a current baseline
- **`NO_COLOR=1`** — all tools run without ANSI codes for clean parsing (runner.js L10)
- **Post-filter safety net** — findings re-checked against ignore rules after tools run (normalizer.js L4-17)
- **3 dependencies only** — commander, ignore, yaml (no test deps, no build tools)
- **SBOM early exit** — `--sbom` bypasses the normal pipeline entirely (index.js L49-70)
