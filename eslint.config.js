// Flat ESLint config for the Sourcerer monorepo (ESLint 10 + typescript-eslint v8).
// A single root config covers every package; each package's `eslint src/` script
// resolves this file by walking up from its own directory.
//
// Strictness: eslint:recommended + typescript-eslint *recommended* (non-type-checked).
// Formatting is owned by Prettier — eslint-config-prettier (applied last) turns off
// any stylistic rules that would otherwise conflict. To add type-aware rules later,
// swap `recommended` for `recommendedTypeChecked` and wire `languageOptions.parserOptions`.
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';

export default tseslint.config(
  {
    // Global ignores (build artifacts, generated output, run data, config/scripts).
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'eval-results/**',
      'runs/**',
      'state/**',
      '**/*.config.{js,ts,mjs,cjs}',
      'apps/cli/scripts/**',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      'unused-imports': unusedImports,
    },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // unused-imports owns unused detection: its `no-unused-imports` rule is
      // auto-fixable (strips dead imports on --fix), which tseslint's is not.
      // Unused locals/args stay errors, with the conventional `_` opt-out.
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          // Callback/interface-conforming params (phase parse/skipIf/prompt
          // signatures, .map indices, optional config args) are legitimately
          // unused by design. Unused locals and imports stay errors.
          args: 'none',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Tests legitimately use `any` for mock casting and internal access.
    files: ['**/*.test.ts', '**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // Disable formatting rules that conflict with Prettier. Must be last.
  prettier,
);
