module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'prettier',
  ],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'simple-import-sort', 'import'],
  parserOptions: {
    project: true,
    tsconfigRootDir: __dirname,
  },
  root: true,
  rules: {
    'simple-import-sort/imports': 'error',
    'simple-import-sort/exports': 'error',
    'import/first': 'error',
    'import/newline-after-import': 'error',
    'import/no-duplicates': 'error',
    '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'separate-type-imports' }],
    'import/consistent-type-specifier-style': ['error', 'prefer-top-level'],
  },
}
