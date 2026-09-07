import { defineBuildConfig } from 'obuild/config'

export default defineBuildConfig({
  entries: [
    { type: 'bundle', input: './src/index.ts', outDir: './dist' },
    { type: 'bundle', input: './src/browser.ts', outDir: './dist' },
  ],
})
