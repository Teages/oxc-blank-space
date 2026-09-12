import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const registerEntry = join(root, 'dist', 'register.mjs')

// the suite drives the compiled entry in child processes; run `pnpm build:js`
// first (CI builds before vitest)
const built = existsSync(registerEntry)
// require() interception needs the in-thread hooks (Node >= 22.15)
const hasSyncHooks = typeof nodeModule.registerHooks === 'function'

function runNode(entry: string, cwd: string) {
  const result = spawnSync(process.execPath, ['--import', registerEntry, entry], {
    cwd,
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

let dir: string
let symlinkOk = false

function write(relative: string, content: string): string {
  const path = join(dir, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return path
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'petrea-register-'))
  // a manifest without a `type` field keeps the sniffing cases hermetic
  // against stray package.json files above the temp directory
  write('package.json', `${JSON.stringify({ name: 'fixtures' }, null, 2)}\n`)

  write(
    'esm/package.json',
    `${JSON.stringify({ type: 'module' }, null, 2)}\n`,
  )
  write(
    'esm/lib.ts',
    `export function greet(who: string): string {
  return \`hello \${who}\`
}
`,
  )
  write('esm/plain.js', 'export const plain = 7\n')
  // the enum proves petrea did the stripping: Node's own type stripping
  // refuses non-erasable syntax, so this entry only runs through the hook
  write(
    'esm/entry.ts',
    `import { greet } from './lib.ts'
import { plain } from './plain.js'
enum Color { Red, Green = 'green' }
const name: string = 'petrea'
console.log(greet(name), Color.Red, Color.Green, plain)
`,
  )

  write(
    'typed-commonjs/package.json',
    `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`,
  )
  write(
    'typed-commonjs/mod.ts',
    `enum Level { Debug = 10 }
const label: string = 'cjs'
module.exports = { Level, label }
`,
  )
  write(
    'typed-commonjs/main.cjs',
    `const { Level, label } = require('./mod.ts')
console.log(label, Level.Debug)
`,
  )

  write(
    'dyn/val.ts',
    `export const value: number = 42
`,
  )
  write(
    'dyn/host.cjs',
    `(async () => {
  const mod = await import('./val.ts')
  console.log('dyn', mod.value)
})()
`,
  )

  write(
    'sniff-esm/app.ts',
    `const value: number = 42
export { value }
console.log('sniffed-esm', value)
`,
  )
  write(
    'sniff-cjs/app.ts',
    `const label: string = 'sniffed-cjs'
console.log(label)
`,
  )

  // module syntax beyond line-start keywords: mid-line export, top-level
  // await, and keywords inside comments must not flip the classification
  write(
    'midline/app.ts',
    `const x: number = 1; export { x }; console.log('midline', x)
`,
  )
  write(
    'tla/app.ts',
    `const value: string = await Promise.resolve('tla')
console.log('tla-ok', value)
`,
  )
  write(
    'comment-block/mod.ts',
    `/*
export { definitelyNotRealSyntax }
*/
const label: string = 'block-comment-cjs'
module.exports = { label }
`,
  )
  write(
    'comment-block/main.cjs',
    `console.log('comment-block:', require('./mod.ts').label)
`,
  )
  // a CommonJS file may return from the top level; the classification probe
  // must compile in a context where that is legal
  write(
    'early-return/mod.ts',
    `if (process.env.PETREA_NEVER_SET) return
module.exports = { ok: 'early-return' }
`,
  )
  write(
    'early-return/main.cjs',
    `console.log('early-return:', require('./mod.ts').ok)
`,
  )
  // declaring a CommonJS wrapper parameter at the top level is ESM-only —
  // the probe must compile with those parameters, like Node's own detection
  write(
    'wrapper-params/app.ts',
    `const require: number = 1
let __filename: string = 'named'
console.log('wrapper-params', require, __filename)
`,
  )

  write('mts/sib.mts', 'export const mtsValue: number = 3\n')
  write(
    'mts/entry.mts',
    `import { mtsValue } from './sib.mts'
console.log('mts', mtsValue)
`,
  )
  write(
    'cts/entry.cts',
    `const label: string = 'cts'
console.log(label)
`,
  )

  write(
    'node_modules/tiny-pkg/package.json',
    `${JSON.stringify({ name: 'tiny-pkg', main: 'index.ts', type: 'module' }, null, 2)}\n`,
  )
  write(
    'node_modules/tiny-pkg/index.ts',
    `export function tiny(): string {
  return 'from-node-modules'
}
`,
  )
  write(
    'esm/pkg-entry.ts',
    `import { tiny } from 'tiny-pkg'
console.log('pkg', tiny())
`,
  )

  write('bad/syntax.ts', 'const a: = ;\n')
  write(
    'unsupported/param.ts',
    `class C { constructor(private a: string) {} }
new C('x')
`,
  )

  // relative imports inside symlinked files must resolve against the real
  // location, matching Node's default realpath resolution
  write(
    'real-pkg/dep.ts',
    `export const dep = (): string => 'dep-ok'
`,
  )
  write(
    'real-pkg/main.ts',
    `import { dep } from './dep.ts'
console.log('symlink', dep(), import.meta.url.includes('real-pkg') ? 'real' : 'alias')
`,
  )
  write('host.mjs', `import './alias-main.ts'
import './alias-pkg/main.ts'
`)
  try {
    symlinkSync(join(dir, 'real-pkg', 'main.ts'), join(dir, 'alias-main.ts'))
    symlinkSync(join(dir, 'real-pkg'), join(dir, 'alias-pkg'))
    symlinkOk = true
  }
  catch {
    // platforms without symlink privileges skip the case
  }
})

describe.skipIf(!built)('petrea/register', () => {
  it('runs ESM TypeScript entries with enums and relative imports', () => {
    const result = runNode('esm/entry.ts', dir)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('hello petrea 0 green 7')
  })

  it.skipIf(!hasSyncHooks)('require()s TypeScript through the in-thread hooks', () => {
    const result = runNode('typed-commonjs/main.cjs', dir)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('cjs 10')
  })

  it('dynamic-imports TypeScript from CommonJS', () => {
    const result = runNode('dyn/host.cjs', dir)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('dyn 42')
  })

  it('classifies manifest-less files as modules by their syntax', () => {
    const result = runNode('sniff-esm/app.ts', dir)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('sniffed-esm 42')
  })

  it('classifies manifest-less files without ESM syntax as CommonJS', () => {
    const result = runNode('sniff-cjs/app.ts', dir)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('sniffed-cjs')
  })

  it('classifies manifest-less modules with mid-line export syntax', () => {
    const result = runNode('midline/app.ts', dir)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('midline 1')
  })

  it('classifies manifest-less modules using top-level await', () => {
    const result = runNode('tla/app.ts', dir)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('tla-ok tla')
  })

  it.skipIf(!hasSyncHooks)('is not fooled by module keywords inside comments', () => {
    const result = runNode('comment-block/main.cjs', dir)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('comment-block: block-comment-cjs')
  })

  it('classifies modules declaring wrapper parameters as ESM', () => {
    const result = runNode('wrapper-params/app.ts', dir)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('wrapper-params 1 named')
  })

  it.skipIf(!hasSyncHooks)('keeps top-level return working in CommonJS files', () => {
    const result = runNode('early-return/main.cjs', dir)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('early-return: early-return')
  })

  it('resolves relative imports inside symlinked files against their real location', ({ skip }) => {
    // decided at runtime: skipIf evaluates before beforeAll creates the links
    if (!symlinkOk) {
      skip('symlinks unavailable on this platform')
    }
    const result = runNode('host.mjs', dir)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    // both the symlinked file and the symlinked package resolve to the same
    // real module, which executes exactly once — and its own relative import
    // found the sibling next to the real location
    expect(result.stdout.trim().split('\n')).toEqual(['symlink dep-ok real'])
  })

  it('runs .mts entries as ESM and .cts entries as CommonJS', () => {
    expect(runNode('mts/entry.mts', dir).stdout.trim()).toBe('mts 3')
    expect(runNode('cts/entry.cts', dir).stdout.trim()).toBe('cts')
  })

  it('strips TypeScript reached through node_modules', () => {
    const result = runNode('esm/pkg-entry.ts', dir)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('pkg from-node-modules')
  })

  it('fails with the transpiler diagnostic on unparseable input', () => {
    const result = runNode('bad/syntax.ts', dir)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/failed to parse .*syntax\.ts/)
  })

  it('warns about kept-verbatim constructs before they fail to parse', () => {
    const result = runNode('unsupported/param.ts', dir)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/petrea: TSParameterProperty at .*param\.ts:1:\d+/)
    // the construct stays verbatim in the module Node rejects
    expect(result.stderr).toContain('private a')
  })
})
