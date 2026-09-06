import antfu from '@antfu/eslint-config'

export default antfu(
  {
    ignores: ['test/fixture/**'],
  },
  {
    files: ['test/**/*.test.ts'],
    rules: {
      // the suite evaluates transpiler output and asserts on template-shaped
      // inputs by design
      'no-new-func': 'off',
      'no-template-curly-in-string': 'off',
    },
  },
)
