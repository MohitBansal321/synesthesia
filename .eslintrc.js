module.exports = {
  root: true,
  env: {
      browser: true,
      node: true,
      es2021: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'prettier'],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error', {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_'
      }
    ],
    'prettier/prettier': 'error',
  }
}