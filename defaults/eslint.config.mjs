// Resilient dynamic import — returns default export (with CJS interop) or null
async function tryImport(specifier) {
  try {
    const mod = await import(specifier);
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

// Shared plumbing for the scope probes below: both the distro-stub probe and
// the svelte parser compat check resolve eslint-scope the same way the
// parsers themselves do — from the process cwd (the scanned project) via
// createRequire, falling back to global node paths.
const { createRequire } = await import("node:module");
const pathMod = await import("node:path");
// A relative name (joined with the process cwd) so resolution behaves
// exactly as the parsers' own getEslintScopeFromUser()/getEspreeFromUser().
const SCOPE_PROBE_FILENAME = "__fcv_scope_probe__.js";
const ESLINT_SCOPE_PACKAGE = "eslint-scope";

// ─── Load all plugins resiliently (graceful degradation if not installed) ───
const sonarjs = await tryImport("eslint-plugin-sonarjs");
const security = await tryImport("eslint-plugin-security");
const tseslint = await tryImport("typescript-eslint");
const react = await tryImport("eslint-plugin-react");
const reactHooks = await tryImport("eslint-plugin-react-hooks");
const vue = await tryImport("eslint-plugin-vue");
const svelte = await tryImport("eslint-plugin-svelte");
const jsonc = await tryImport("eslint-plugin-jsonc");
const jsdoc = await tryImport("eslint-plugin-jsdoc");

// Two plugins have peers that npm will NOT auto-install under
// `--legacy-peer-deps` (the install.sh path), and whose absence breaks the
// plugin itself: eslint-plugin-svelte fails its module import without the
// `svelte` compiler, and eslint-plugin-vue parses nothing without
// vue-eslint-parser. A half-loaded plugin is worse than an absent one — it
// produces parser crashes on the exact files it claims to lint. Gate the
// framework blocks on the peer and, when only the peer is missing, say so.
const svelteCompiler = await tryImport("svelte");
const vueParser = await tryImport("vue-eslint-parser");

// eslint's JS language core added `scopeManager.addGlobals()` in v10 and
// calls it on every source verification (lib/languages/js/source-code.js).
// svelte-eslint-parser bundles its own eslint-scope (dep range ^8.2.0,
// currently 8.4.0), whose ScopeManager has not gained addGlobals — so the
// pair svelte-eslint-parser@1.8.x + eslint@10 crashes on the first svelte
// file with `TypeError: scopeManager.addGlobals is not a function`,
// independent of the OS or host. eslint@9 (<=9.x) has no such call, the
// pair works there. Detect the nested scope of the INSTALLED parser the
// same way the parser itself resolves it (plugin-relative, so the hoisted
// root scope cannot mask the nested one) and stay off svelte when the
// combination is broken: a crashing rule set is never better than none.
let eslintMajor = 0;
try {
  // Importing a .json module needs the import-attributes form (node >=20.10),
  // with the legacy `assert` variant as fallback for older 20.x.
  let eslintPkg = null;
  try {
    eslintPkg = await import("eslint/package.json", { with: { type: "json" } });
  } catch {
    try {
      eslintPkg = await import("eslint/package.json", { assert: { type: "json" } });
    } catch {
      eslintPkg = null;
    }
  }
  eslintMajor = Number(String((eslintPkg?.default ?? eslintPkg)?.version ?? "0").split(".")[0]) || 0;
} catch {
  eslintMajor = 0;
}

// The svelte/vue parsers both resolve eslint-scope (and espree) from
// process.cwd() — the scanned project — falling back to global system paths
// when the project has no such package. On some distro-managed hosts that
// fallback resolves stub packages exporting non-semver "versions"
// (`/usr/share/nodejs/eslint-scope` exposes version "main"), and the parser
// then dies with `semver: Invalid Version: main` on every framework file,
// or with a broken scopeManager (addGlobals missing). Probe exactly what the
// parsers probe: if nothing resolves, they use their own bundle (fine); if a
// stub resolves, disable the framework lanes and say why.
async function probeUserScope() {
  try {
    const cwdRequire = createRequire(pathMod.join(process.cwd(), SCOPE_PROBE_FILENAME));
    const scope = cwdRequire(ESLINT_SCOPE_PACKAGE);
    const version = scope?.version ?? scope?.default?.version;
    if (version == null || version === "") return true; // parser sticks to its bundle
    return /^\d+\.\d+\.\d+/.test(String(version)); // "main" fails, "8.4.1" passes
  } catch {
    return true; // nothing to resolve — parser uses its own bundled scope
  }
}
const scopeHealthy = await probeUserScope();

// When typescript-eslint isn't available, exclude TS files from patterns
// to avoid parse errors from the default JS parser
const jsFiles = ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.jsx"];
const tsFiles = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
const codeFiles = tseslint ? [...jsFiles, ...tsFiles] : jsFiles;

// The shipped extras (sonarjs quality rules, security anti-patterns) are
// optional at npm-install time: devDependencies here, CONFIG_PEERS for
// install.sh users, bring-your-own for registry consumers. Silent loss of
// cognitive-complexity looks like a bug, so say exactly what is off and
// how to enable it. stderr only — eslint report flows on stdout.
const missingExtras = [];
if (!sonarjs) missingExtras.push("eslint-plugin-sonarjs");
if (!security) missingExtras.push("eslint-plugin-security");
if (missingExtras.length > 0) {
  console.error(
    `[fast-cv eslint defaults] ${missingExtras.join(", ")} not found — related rules disabled (optional extras). To enable: npm install ${missingExtras.join(" ")}`,
  );
}
const missingPeers = [];
if (svelte && !svelteCompiler) missingPeers.push("svelte");
if (vue && !vueParser) missingPeers.push("vue-eslint-parser");
if (missingPeers.length > 0) {
  console.error(
    `[fast-cv eslint defaults] ${missingPeers.join(", ")} missing (peer required by framework plugin) — framework rules disabled. To enable: npm install ${missingPeers.join(" ")}`,
  );
}
let brokenScopeVersion = null;
if (!scopeHealthy) {
  try {
    const cwdRequire = createRequire(pathMod.join(process.cwd(), SCOPE_PROBE_FILENAME));
    brokenScopeVersion = cwdRequire(ESLINT_SCOPE_PACKAGE)?.version ?? "unknown";
  } catch {
    brokenScopeVersion = "unknown";
  }
  console.error(
    `[fast-cv eslint defaults] eslint-scope resolved from this directory reports invalid version "${brokenScopeVersion}" (a distro stub in global node fallback paths) — svelte/vue parsers crash on it, so framework rules are disabled. Fix: npm install eslint-scope espree in this project, or scan it with real local node_modules.`,
  );
}
let svelteUsable = svelte && svelteCompiler && scopeHealthy;
if (svelteUsable && eslintMajor >= 10) {
  try {
    // node:url carries fileURLToPath — node:path does not. Mistaking the two
    // would fail the introspection silently and leave the broken lane on.
    const { fileURLToPath } = await import("node:url");
    const entryRequire = createRequire(pathMod.dirname(fileURLToPath(import.meta.url)));
    const parserEntry = entryRequire.resolve("svelte-eslint-parser");
    const parserScope = createRequire(parserEntry)(ESLINT_SCOPE_PACKAGE);
    if (typeof parserScope?.ScopeManager?.prototype?.addGlobals !== "function") {
      svelteUsable = false;
      console.error(
        `[fast-cv eslint defaults] svelte-eslint-parser bundles eslint-scope ${parserScope?.version ?? "unknown"} without ScopeManager#addGlobals, which eslint@${eslintMajor}.x requires — svelte rules disabled until the parser ships eslint-scope 9.x (or pin eslint@9 to keep them).`,
      );
    }
  } catch {
    // Probe-only failure — do not disable a lane because our introspection
    // itself failed; the scan continues and real linting decides.
  }
}

const config = [
  // ─── sonarjs (recommended rules + project overrides) ───────────────
  // Register the plugin once. ESLint 10+ rejects duplicate plugin
  // declarations, so we cannot also spread sonarjs.configs.recommended
  // (which registers `plugins: { sonarjs }`) AND register the plugin in
  // the base rules block — pick one home for the registration.
  ...(sonarjs ? [{
    files: codeFiles,
    plugins: { sonarjs },
    rules: {
      ...(sonarjs.configs?.recommended?.rules ?? {}),
      "sonarjs/cognitive-complexity": ["warn", 15],
      // sonarjs v4 schema: { threshold } object, not a bare number
      "sonarjs/no-duplicate-string": ["warn", { threshold: 3 }],
      "sonarjs/max-switch-cases": ["warn", 10],
      "sonarjs/no-identical-functions": "warn",
      // Disabled with audit-grade justification:
      //   no-os-command-from-path flags every `execFile("eslint", …)` /
      //   `execFile("git", …)` call. A tool orchestrator that runs other
      //   CLIs MUST resolve them via PATH (we don't know where users
      //   installed ruff/eslint/git on their machine). Hard-coding
      //   absolute paths would break the product. The threat model
      //   (attacker controls $PATH) requires shell-level compromise,
      //   which is out of scope — the tool runs with user privileges.
      "sonarjs/no-os-command-from-path": "off",
      //   publicly-writable-directories fires on every `/tmp` literal.
      //   In src/, fast-cv uses `mkdtemp(/tmp/fast-cv-XXXXXX)` (random
      //   suffix → race-free) for transient tool I/O — the documented-
      //   safe pattern. The rule cannot distinguish mkdtemp from raw
      //   `/tmp/static-name`, so it false-positives uniformly. Disabled
      //   project-wide; if a future change adds raw /tmp paths the
      //   security-review checklist (architecture.md) must catch it.
      "sonarjs/publicly-writable-directories": "off",
    },
  }] : []),

  // ─── Base rules (JS + TS) ──────────────────────────────────────────
  {
    files: codeFiles,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
      "no-proto": "error",
      "no-caller": "error",
      "no-extend-native": "error",
      // Standard convention: `_`-prefixed identifiers signal "intentionally
      // unused" (function args following an interface, catch params).
      "no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
      "no-unreachable": "error",
      // Thresholds set at industry-strict levels (sonarjs/eslint defaults).
      // Our own code is expected to pass these — refactor, don't relax.
      "complexity": ["warn", { "max": 15 }],
      "max-depth": ["warn", 4],
      "max-lines-per-function": ["warn", { "max": 100, "skipBlankLines": true, "skipComments": true }],
      "max-nested-callbacks": ["warn", 3],
    },
  },

  // ─── eslint-plugin-security ────────────────────────────────────────
  // Spread the recommended ruleset. Every disable below has an
  // audit-defensible justification documented inline — we do not
  // silence rules just to make the linter quiet.
  ...(security ? [{
    files: codeFiles,
    plugins: { security },
    rules: {
      ...(security.configs?.recommended?.rules ?? {
        "security/detect-buffer-noassert": "warn",
        "security/detect-child-process": "warn",
        "security/detect-disable-mustache-escape": "warn",
        "security/detect-eval-with-expression": "warn",
        "security/detect-new-buffer": "warn",
        "security/detect-no-csrf-before-method-override": "warn",
        "security/detect-non-literal-fs-filename": "warn",
        "security/detect-non-literal-regexp": "warn",
        "security/detect-non-literal-require": "warn",
        "security/detect-object-injection": "warn",
        "security/detect-possible-timing-attacks": "warn",
        "security/detect-pseudoRandomBytes": "warn",
        "security/detect-unsafe-regex": "warn",
      }),
      // Off: ESM-only project. require() is not used; rule is unreachable.
      "security/detect-non-literal-require": "off",
      // Off with audit-grade justification:
      //   detect-non-literal-fs-filename fires when an fs.* call receives
      //   a variable path. A code-scanning tool reads paths by design —
      //   every adapter (ruff, eslint, semgrep, …) calls fs against the
      //   user-supplied target directory.
      //
      //   Trust boundary: paths originate from one of three places:
      //     (1) the user's CLI argument (target dir + --exclude/--only),
      //     (2) the pruner walking that dir (gitignore/.fcvignore filtered),
      //     (3) shipped configs in defaults/ + user defaults in
      //         ~/.config/fast-cv/.
      //   The tool runs with the user's own privileges; there is no
      //   privilege boundary to cross. Path traversal is prevented at
      //   src/pruner.js by resolving entries against the target root.
      //
      //   Keeping the rule on would require 100+ per-line suppressions
      //   citing this same justification. Disabled globally; the trust
      //   boundary is documented in docs/architecture.md → Security.
      "security/detect-non-literal-fs-filename": "off",
    },
  }] : []),

  // ─── TypeScript (typescript-eslint) ────────────────────────────────
  ...(tseslint?.configs?.recommended
    ? tseslint.configs.recommended.map(c => ({
        ...c,
        files: c.files ?? ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
      }))
    : []),

  // ─── React (eslint-plugin-react + react-hooks) ────────────────────
  ...(react ? [{
    files: ["**/*.jsx", "**/*.tsx"],
    plugins: {
      react,
      ...(reactHooks ? { "react-hooks": reactHooks } : {}),
    },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...(react.configs?.recommended?.rules ?? {}),
      ...(reactHooks?.configs?.recommended?.rules ?? {}),
      "react/react-in-jsx-scope": "off",
    },
  }] : []),

  // ─── Vue (eslint-plugin-vue) ───────────────────────────────────────
  ...(vue && vueParser && scopeHealthy ? (vue?.configs?.["flat/recommended"] ?? []) : []),

  // ─── Svelte (eslint-plugin-svelte) ─────────────────────────────────
  ...(svelteUsable ? (svelte?.configs?.["flat/recommended"] ?? []) : []),

  // ─── JSON (eslint-plugin-jsonc) ────────────────────────────────────
  ...(jsonc?.configs?.["flat/recommended-with-json"] ?? []),

  // ─── JSDoc (eslint-plugin-jsdoc) ──────────────────────────────────
  // require-jsdoc is opinionated — many projects deliberately keep
  // JSDoc sparse. We validate existing JSDoc (param names, tags, types)
  // but do NOT require it on every public function. Projects that want
  // mandatory JSDoc can re-enable it in their local config.
  ...(jsdoc ? [{
    files: codeFiles,
    plugins: { jsdoc },
    rules: {
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-description": "off",
      "jsdoc/require-param": "off",
      "jsdoc/require-returns": "off",
      "jsdoc/valid-types": "warn",
      "jsdoc/check-param-names": "warn",
      "jsdoc/check-tag-names": "warn",
    },
  }] : []),

  // ─── Test-file relaxations ────────────────────────────────────────
  // Test files use long describe blocks, repeated literals (mock paths
  // like "/tmp/project"), and intentional complexity (parametric cases).
  // Don't apply the same length/duplication/complexity discipline as
  // production code.
  {
    files: ["**/*.test.js", "**/*.spec.js", "test/**/*.js"],
    rules: {
      "max-lines-per-function": "off",
      "max-nested-callbacks": "off",
      "complexity": "off",
      "sonarjs/no-duplicate-string": "off",
      "sonarjs/cognitive-complexity": "off",
      "sonarjs/no-identical-functions": "off",
      // Tests legitimately use Math.random for fixture data and http URLs
      // in $ref-resolution fixtures; neither is a real security issue.
      "sonarjs/pseudo-random": "off",
      "sonarjs/no-clear-text-protocols": "off",
    },
  },
];

export default config;
