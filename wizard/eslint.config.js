import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['build/**', 'node_modules/**', 'public/**', 'cypress/**', '.system-bootstrapper/**', 'build-tools/**'] },
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
