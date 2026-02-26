# Architecture

Node.js ESM CLI that orchestrates linters and security scanners sequentially, outputting unified Markdown or SARIF reports. Zero build step, 3 runtime dependencies.

## File Map

| File | Lines | Purpose |
|------|------:|---------|
| `bin/fast-cv.js` | 4 | Entry point — calls `run(process.argv)` |
| `src/index.js` | 247 | CLI definition, 12-step pipeline, `install-hook` subcommand |
| `src/pruner.js` | 175 | File discovery, ignore/only filtering, language detection |
| `src/precheck.js` | 110 | Tool installation verification and auto-install |
| `src/config-resolver.js` | 84 | Config resolution chain (local → user → package → none) |
| `src/runner.js` | 143 | Sequential tool execution with verbose progress |
| `src/normalizer.js` | 103 | Markdown report formatting + post-filter |
| `src/sarif.js` | 97 | SARIF 2.1.0 output formatting |
| `src/findings.js` | 15 | Shared finding collection helper |
| `src/constants.js` | 29 | Shared constants and JSON Lines parser |
| `src/line-check.js` | 42 | Built-in file length checker |
| `src/git-changes.js` | 74 | Git-changed file detection |
| `src/tools/index.js` | 18 | Tool registry — exports all 15 adapters |
| `src/tools/ruff.js` | 94 | Python linter/formatter |
| `src/tools/eslint.js` | 135 | JavaScript/TypeScript linter |
| `src/tools/semgrep.js` | 72 | Multi-language SAST |
| `src/tools/bearer.js` | 82 | Privacy/PII scanner |
| `src/tools/golangci-lint.js` | 88 | Go linter |
| `src/tools/jscpd.js` | 114 | Copy-paste detector |
| `src/tools/trivy.js` | 106 | SCA + IaC + secrets + license scanner |
| `src/tools/mypy.js` | 52 | Python type checker |
| `src/tools/typos.js` | 53 | Typo finder (opt-in) |
| `src/tools/vulture.js` | 56 | Python dead code finder |
| `src/tools/knip.js` | 104 | JS/TS unused code finder |
| `src/tools/tsc.js` | 51 | TypeScript type checker |
| `src/tools/clippy.js` | 74 | Rust linter (clippy) |
| `src/tools/stylelint.js` | 74 | CSS/SCSS/Less linter |
| `src/tools/sqlfluff.js` | 75 | SQL linter |
| `defaults/ruff.toml` | 57 | Shipped ruff config |
| `defaults/eslint.config.mjs` | 133 | Shipped eslint config (9 plugins) |
| `defaults/mypy.ini` | 4 | Shipped mypy config |
| `defaults/semgrep/` | dir | Shipped semgrep rules (taint.yaml + owasp-top-ten.yaml) |
| `defaults/.golangci.yml` | 10 | Shipped golangci-lint config (revive exported rule) |
| `install.sh` | 430 | Full installer (modes: all, app, configs) |

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
7. **Sequential Run** (L155-158) — Run tools one at a time with timeout + verbose progress
8. **Line-Check** (L160-164) — Built-in file length checker
9. **Post-Filter** (L166-167) — Strip findings from ignored/excluded files
10. **Docstring Filter** (L169-173) — Suppress DOCS findings if `--no-docstring`
11. **Format + Output** (L175-181) — Generate Markdown or SARIF report, write to stdout
12. **Exit Code** (L183-184) — 0=clean, 1=findings

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
- **SIGTERM → SIGKILL** — 5s grace after SIGTERM before force-kill (runner.js L19-27)
- **`NO_COLOR=1`** — all tools run without ANSI codes for clean parsing (runner.js L10)
- **Post-filter safety net** — findings re-checked against ignore rules after tools run (normalizer.js L4-17)
- **3 dependencies only** — commander, ignore, yaml (no test deps, no build tools)
- **SBOM early exit** — `--sbom` bypasses the normal pipeline entirely (index.js L49-70)
