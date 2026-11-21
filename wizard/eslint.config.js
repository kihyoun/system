import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  // This generated offline capsule includes vendored Nest dependencies. Its
  // producer hashes and offline behavior are checked by the operations gates;
  // keep authored .gitlab launchers under the normal frontend lint rules.
  { ignores: ['build/**', 'node_modules/**', 'public/**', 'cypress/**', '.system-bootstrapper/**', 'build-tools/**', '.gitlab/runtime/project-ci.cjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,cjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.vitest } },
    plugins: { 'react-hooks': hooks },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-hooks/rules-of-hooks': 'error'
    }
  },
  { files: ['**/*.cjs', '.gitlab/*.js'], rules: { '@typescript-eslint/no-require-imports': 'off' } }
);
