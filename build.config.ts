import { defineBuildConfig } from 'obuild/config'

export default defineBuildConfig({
  entries: [
    { type: 'bundle', input: './src/index.ts', outDir: './dist' },
    {
      type: 'bundle',
      input: './src/wasm.ts',
      outDir: './dist',
      rolldown: {
        // the default `node` platform pulls node builtins into the bundle,
        // which browsers cannot load
        platform: 'browser',
        // the wasm binding ships as a separate package; keep the bare import
        // so consumers resolve it (and its wasm asset) from node_modules
        external: ['@petrea/binding-wasm32-wasip1'],
      },
    },
  ],
})
