// Standalone smoke test for a built native binding, runnable on any target
// platform (including inside docker images) with no repo dependencies:
//
//   node scripts/smoke-native.mjs dist/oxc-blank-space-native.linux-x64-gnu.node
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import process from 'node:process'

const binary = process.argv[2]
if (!binary) {
  console.error('usage: node scripts/smoke-native.mjs <path-to-.node>')
  process.exit(1)
}
// paths passed on the command line resolve against the caller's cwd
const binaryPath = resolve(process.cwd(), binary)

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL (${process.platform}-${process.arch} ${process.version}): ${message}`)
    process.exit(1)
  }
}

const binding = createRequire(import.meta.url)(binaryPath)

// line/column-preserving blanking
const result = binding.transpileNativeSync('const a: number = 1', { filename: 'a.ts' })
assert(result.code === 'const a         = 1', `transpile mismatch: ${JSON.stringify(result.code)}`)

// enum expansion and UTF-16 round-trip with an astral character
const enumResult = binding.transpileNativeSync('enum Color { Red }')
assert(
  enumResult.code.includes('Color[Color["Red"] = 0] = "Red"'),
  `enum expansion mismatch: ${JSON.stringify(enumResult.code)}`,
)
const utf16 = binding.transpileUtf16Sync(
  Uint16Array.from('const a: number = 1 // 😀'.split('').map(c => c.charCodeAt(0))),
)
assert(
  String.fromCharCode(...utf16.code) === 'const a         = 1 // 😀',
  'utf16 round-trip mismatch',
)

// parse errors reject with a codeframe-carrying message
let threw
try {
  binding.transpileNativeSync('const a: = 1', { filename: 'a.ts' })
}
catch (error) {
  threw = error
}
assert(threw instanceof Error && threw.message.includes('a.ts'), 'parse error did not produce a codeframe')

// the async (threaded) entries resolve
const asyncResult = await binding.transpileAsync('type T = number', { filename: 'a.ts' })
assert(asyncResult.code.trim().length === 0, `async transpile mismatch: ${JSON.stringify(asyncResult.code)}`)
await binding.transpileUtf16Async(Uint16Array.from([97]))

console.log(`OK ${process.platform}-${process.arch} node ${process.version} (${binary})`)
