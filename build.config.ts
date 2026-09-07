import { defineBuildConfig } from 'obuild/config'

export default defineBuildConfig({
  entries: [
    { type: 'bundle', input: './src/index.ts', outDir: './dist' },
    {
      type: 'bundle',
      input: './src/browser.ts',
      outDir: './dist',
      // the default `node` platform pulls node builtins into the bundle,
      // which browsers cannot load
      rolldown: { platform: 'browser' },
    },
  ],
})
