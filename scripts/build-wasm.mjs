import { execSync } from 'node:child_process'
// Builds the Rust binding for wasm32-wasip1 into the `wasm/` staging dir,
// keeping only the artifacts the package consumes: the .wasm module, the Node
// loader (.wasip1.cjs) and the browser loader (.wasip1-browser.js). The
// browser entry bundles the loader; `scripts/assemble-dist.mjs` copies the
// rest into dist for shipping and testing.
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const staging = join(root, 'wasm')

rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })

execSync(
  'pnpm exec napi build --platform --release --target wasm32-wasip1 --output-dir ../wasm',
  { cwd: join(root, 'native'), stdio: 'inherit' },
)

const keep = new Set([
  'oxc-blank-space-native.wasm32-wasip1.wasm',
  'oxc-blank-space-native.wasip1.cjs',
  'oxc-blank-space-native.wasip1-browser.js',
])
for (const file of readdirSync(staging)) {
  if (!keep.has(file)) {
    rmSync(join(staging, file), { force: true })
  }
}
