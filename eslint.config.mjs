import tseslint from 'typescript-eslint';
import path from 'node:path';

const projectStyle = {
  rules: {
    'file-name': {
      meta: {
        type: 'layout',
        schema: [],
        messages: {
          camelCase: 'Use a camelCase TypeScript filename; NestJS dot suffixes are retained.',
        },
      },
      create(context) {
        return {
          Program(node) {
            const filename = path.basename(context.filename);
            if (!/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*\.(?:ts|mts)$/.test(filename)) {
              context.report({ node, messageId: 'camelCase' });
            }
          },
        };
      },
    },
  },
};

export default [
  {
    files: ['src/**/*.{ts,mts}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin, 'project-style': projectStyle },
    rules: {
      'constructor-super': 'error',
      'no-constant-condition': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'all'],
      'brace-style': ['error', '1tbs', { allowSingleLine: false }],
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'if' },
        { blankLine: 'always', prev: 'if', next: '*' },
      ],
      'project-style/file-name': 'error',
      '@typescript-eslint/array-type': ['error', { default: 'array', readonly: 'array' }],
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
        {
          selector: 'interface',
          format: ['PascalCase'],
          custom: { regex: '^I[A-Z]', match: false },
        },
        { selector: 'enumMember', format: ['PascalCase'] },
        { selector: 'function', format: ['camelCase'] },
        { selector: 'variable', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        {
          selector: ['classProperty', 'classMethod', 'accessor'],
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        { selector: ['typeProperty', 'typeMethod'], format: ['camelCase'] },
        { selector: 'typeProperty', modifiers: ['requiresQuotes'], format: null },
        // Preserve Docker, GitLab and environment-variable wire fields.
        {
          selector: 'typeProperty',
          filter: {
            regex:
              '^(?:[A-Z][A-Z0-9_]+|[a-z][a-z0-9]*(?:_[a-z0-9]+)+|Id|Image|Mounts|State|Running|OOMKilled|Dead|Status|Restarting|ExitCode|Paused|Config|Labels|Hostname|Destination|Type|Name|Source|HostConfig|RestartPolicy|MaximumRetryCount|PidMode|NetworkMode|Driver|Options|RestartCount|RepoDigests|Os|Architecture|Runtime|IPAddress)$',
            match: true,
          },
          format: null,
        },
      ],
      '@typescript-eslint/no-duplicate-type-constituents': 'off',
    },
  },
];
