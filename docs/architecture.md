# Architecture

Node.js ESM CLI that orchestrates linters and security scanners sequentially, outputting unified Markdown or SARIF reports. Zero build step, 3 runtime dependencies.

## File Map

| File | Lines | Purpose |
|------|------:|---------|
| `bin/fast-cv.js` | 4 | Entry point — calls `run(process.argv)` |
| `src/index.js` | 196 | CLI definition, 10-step pipeline, `install-hook` subcommand |
| `src/pruner.js` | 190 | File discovery, ignore/only filtering, language detection |
| `src/precheck.js` | 110 | Tool installation verification and auto-install |
| `src/config-resolver.js` | 75 | Config resolution chain (local → user → package → none) |
| `src/runner.js` | 130 | Sequential tool execution with verbose progress |
| `src/normalizer.js` | 109 | Markdown report formatting + post-filter |
| `src/sarif.js` | 103 | SARIF 2.1.0 output formatting |
| `src/tools/index.js` | 14 | Tool registry — exports all 11 adapters |
| `src/tools/ruff.js` | 94 | Python linter/formatter |
| `src/tools/eslint.js` | 131 | JavaScript/TypeScript linter |
| `src/tools/semgrep.js` | 72 | Multi-language SAST |
| `src/tools/bearer.js` | 70 | Privacy/PII scanner |
| `src/tools/golangci-lint.js` | 79 | Go linter |
| `src/tools/jscpd.js` | 123 | Copy-paste detector |
| `src/tools/trivy.js` | 106 | SCA + IaC + secrets + license scanner |
| `src/tools/mypy.js` | 52 | Python type checker |
| `src/tools/typos.js` | 53 | Typo finder (opt-in) |
| `src/tools/vulture.js` | 56 | Python dead code finder |
| `src/tools/knip.js` | 105 | JS/TS unused code finder |
| `defaults/ruff.toml` | 57 | Shipped ruff config |
| `defaults/eslint.config.mjs` | 33 | Shipped eslint config |
| `defaults/mypy.ini` | 4 | Shipped mypy config |
| `defaults/semgrep/` | dir | Shipped semgrep rules (taint.yaml + owasp-top-ten.yaml) |
| `install.sh` | 406 | Full installer (modes: all, app, configs) |

## Pipeline (10 Steps)

```
src/index.js
```

1. **CLI Parse** (L17-33) — Commander parses flags and arguments
2. **Prune Directory** (L81) — Walk tree, apply ignore rules, detect languages
3. **Filter Tools** (L90-104) — Match tools by language extensions + `--tools` flag
4. **Precheck** (L112-116) — Verify tools are installed (optional auto-install)
5. **Resolve Configs** (L121-126) — Find config for each tool (4-level chain)
6. **Sequential Run** (L129-130) — Run tools one at a time with timeout + verbose progress
7. **Post-Filter** (L133) — Strip findings from ignored/excluded files
8. **Format** (L137) — Generate Markdown or SARIF report
9. **Output** (L138) — Write report to stdout
10. **Exit Code** (L140-141) — 0=clean, 1=findings

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
- **SIGTERM → SIGKILL** — 5s grace after SIGTERM before force-kill (runner.js L20-24)
- **`NO_COLOR=1`** — all tools run without ANSI codes for clean parsing (runner.js L10)
- **Post-filter safety net** — findings re-checked against ignore rules after tools run (normalizer.js L3-17)
- **3 dependencies only** — commander, ignore, yaml (no test deps, no build tools)
- **SBOM early exit** — `--sbom` bypasses the normal pipeline entirely (index.js L44-65)
