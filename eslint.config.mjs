// Flat config. eslint 8.57 needs ESLINT_USE_FLAT_CONFIG=true (set in the npm
// script); eslint 9+ uses this format natively, so the pending eslint major
// update can actually be verified by CI rather than merged blind.
import tsplugin from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: { '@typescript-eslint': tsplugin },
    rules: {
      '@typescript-eslint/no-unused-vars': 'error',
      'no-undef': 'off',
    },
  },
];
