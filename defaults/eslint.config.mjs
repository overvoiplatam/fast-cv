// Resilient dynamic import — returns default export (with CJS interop) or null
async function tryImport(specifier) {
  try {
    const mod = await import(specifier);
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

// ─── Load all plugins resiliently (graceful degradation if not installed) ───
const sonarjs = await tryImport("eslint-plugin-sonarjs");
const security = await tryImport("eslint-plugin-security");
const tseslint = await tryImport("typescript-eslint");
const react = await tryImport("eslint-plugin-react");
const reactHooks = await tryImport("eslint-plugin-react-hooks");
const vue = await tryImport("eslint-plugin-vue");
const svelte = await tryImport("eslint-plugin-svelte");
const jsonc = await tryImport("eslint-plugin-jsonc");

const config = [
  // ─── sonarjs recommended (JS + TS) ─────────────────────────────────
  ...(sonarjs?.configs?.recommended ? [sonarjs.configs.recommended] : []),

  // ─── Base rules (JS + TS) ──────────────────────────────────────────
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.jsx", "**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    ...(sonarjs ? { plugins: { sonarjs } } : {}),
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
      "no-unused-vars": "warn",
      "no-unreachable": "error",
      "complexity": ["warn", { "max": 10 }],
      "max-depth": ["warn", 4],
      "max-lines-per-function": ["warn", { "max": 50, "skipBlankLines": true, "skipComments": true }],
      "max-nested-callbacks": ["warn", 3],
      // sonarjs overrides (only active if plugin loaded)
      ...(sonarjs ? {
        "sonarjs/cognitive-complexity": ["warn", 15],
        "sonarjs/no-duplicate-string": ["warn", 3],
        "sonarjs/max-switch-cases": ["warn", 10],
        "sonarjs/no-identical-functions": "warn",
      } : {}),
    },
  },

  // ─── eslint-plugin-security ────────────────────────────────────────
  ...(security ? [{
    files: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.jsx", "**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    plugins: { security },
    rules: security.configs?.recommended?.rules ?? {
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
  ...(vue?.configs?.["flat/recommended"] ?? []),

  // ─── Svelte (eslint-plugin-svelte) ─────────────────────────────────
  ...(svelte?.configs?.["flat/recommended"] ?? []),

  // ─── JSON (eslint-plugin-jsonc) ────────────────────────────────────
  ...(jsonc?.configs?.["flat/recommended-with-json"] ?? []),
];

export default config;
