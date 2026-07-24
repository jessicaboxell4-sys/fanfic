// scripts/eslint.no_undef.config.mjs
// Minimal ESLint flat-config that enables ONLY `no-undef`.
//
// Rationale (2026-07-20): The project's normal CRA/webpack build treats
// `no-undef` as a WARNING, so ghost-function references like the
// EmailStatsCard `load` bug (iter 102/103) slip through and hit
// production.  This config is what pre_deploy.sh runs — a strict
// `--max-warnings 0` sweep with only the rule that matters, so we
// catch the exact bug shape without also failing on the hundreds of
// pre-existing style/hook-dep warnings the codebase carries.
//
// If a check trips: the offending file:line will be printed and the
// deploy is blocked until the identifier is declared or removed.

import globals from "globals";
import reactPlugin from "eslint-plugin-react";

export default [
  {
    // Skip node_modules, build output, tests, and generated code.
    ignores: [
      "**/node_modules/**",
      "**/build/**",
      "**/dist/**",
      "**/*.min.js",
      "**/coverage/**",
    ],
  },
  {
    files: ["src/**/*.{js,jsx}"],
    // Turn off inline directive processing — this config only wants to
    // enforce `no-undef`; the rest of the codebase has hundreds of
    // pre-existing `/* eslint-disable rule-name */` comments referring
    // to rules we deliberately don't load here.  Without this, every
    // such comment fires "Definition for rule 'X' was not found".
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: false,
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
        // App-specific globals used at runtime:
        process: "readonly",
      },
    },
    // Tell ESLint that JSX identifiers like `<Foo />` count as
    // references to `Foo`, otherwise `no-undef` would false-fire on
    // every capitalised component.
    plugins: { react: reactPlugin },
    rules: {
      "no-undef": "error",
      "react/jsx-no-undef": "error",
    },
    settings: { react: { version: "detect" } },
  },
];
