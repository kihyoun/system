import tseslint from 'typescript-eslint';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {parser: tseslint.parser},
    plugins: {'@typescript-eslint': tseslint.plugin},
    rules: {
      'constructor-super': 'error',
      'no-constant-condition': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      '@typescript-eslint/no-duplicate-type-constituents': 'off'
    }
  }
];
