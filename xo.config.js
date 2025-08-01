export default {
  space: 2,
  semicolon: true,
  prettier: false,
  rules: {
    'unicorn/prevent-abbreviations': 'off',
    'import/extensions': 'off',
    '@stylistic/comma-dangle': 'off',
    '@stylistic/object-curly-spacing': 'off',
    'unicorn/no-process-exit': 'off',
    'n/prefer-global/process': 'off',
    'unicorn/import-style': 'off',
    'promise/prefer-await-to-then': 'off',
    'no-return-await': 'off',
    'unicorn/catch-error-name': ['error', {name: 'err'}],
    'unicorn/no-array-for-each': 'off'
  }
};
