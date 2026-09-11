import antfu from '@antfu/eslint-config'

export default antfu(
  {
    ignores: ['test/fixture/**', 'native/**', 'wasm/**', 'binaries/**'],
  },
  {
    // tsx-runtime.ts is test infrastructure: it evaluates transpiler output
    // through the TypeScript compiler by design
    files: ['test/**/*.test.ts', 'test/tsx-runtime.ts'],
    rules: {
      // the suite evaluates transpiler output and asserts on template-shaped
      // inputs by design
      'no-new-func': 'off',
      'no-template-curly-in-string': 'off',
    },
  },
)
