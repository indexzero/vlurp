export default {
  space: 2,
  semicolon: true,
  prettier: false,
  rules: {
    'unicorn/prevent-abbreviations': 'off',
    'import/extensions': 'off',
    '@stylistic/comma-dangle': ['error', 'never'],
    '@stylistic/object-curly-spacing': 'off',
    'unicorn/no-process-exit': 'off',
    'unicorn/import-style': 'off',
    'no-return-await': 'off',
    'unicorn/catch-error-name': ['error', { name: 'err' }],
    'unicorn/no-array-for-each': 'off'
  }
};
