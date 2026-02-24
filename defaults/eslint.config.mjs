import sonarjs from "eslint-plugin-sonarjs";

export default [
  sonarjs.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.jsx"],
    plugins: { sonarjs },
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
      // sonarjs overrides
      "sonarjs/cognitive-complexity": ["warn", 15],
      "sonarjs/no-duplicate-string": ["warn", 3],
      "sonarjs/max-switch-cases": ["warn", 10],
      "sonarjs/no-identical-functions": "warn",
    },
  },
];
