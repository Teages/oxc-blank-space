import { execSync } from 'node:child_process'
// Orchestrates the full package build:
//
// 1. place the generated wasm loader where the browser entry bundles it
//    (`wasm/`, created by scripts/build-wasm.mjs or copied from artifacts)
// 2. run obuild (bundles src/index.ts and src/browser.ts; cleans dist)
// 3. copy the platform binaries + wasm module into the cleaned dist
//
// Binary sources:
// - default (dev/CI): build the local platform binary and the wasm target.
// - NAPI_PREBUILT_DIR (release pack): copy the per-platform binaries and wasm
//   artifacts produced by the `native build` workflow instead of building.
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const binaries = join(root, 'binaries')
const prebuilt = process.env.NAPI_PREBUILT_DIR

function placeWasmStaging(sourceDir) {
  mkdirSync(join(root, 'wasm'), { recursive: true })
  cpSync(
    join(sourceDir, 'oxc-blank-space-native.wasip1-browser.js'),
    join(root, 'wasm/oxc-blank-space-native.wasip1-browser.js'),
  )
}

function collectBinaries(distDir) {
  for (const file of readdirSync(distDir)) {
    if (file.endsWith('.node')) {
      cpSync(join(distDir, file), join(dist, file))
    }
  }
}

function placeWasmAssets(sourceDir) {
  // the bundled browser loader fetches the module next to browser.mjs
  cpSync(
    join(sourceDir, 'oxc-blank-space-native.wasm32-wasip1.wasm'),
    join(dist, 'oxc-blank-space-native.wasm32-wasip1.wasm'),
  )
  mkdirSync(join(dist, 'wasm'), { recursive: true })
  // the node-side test loader resolves the module next to itself, so point
  // it one level up at the shipped wasm
  const loader = readFileSync(join(sourceDir, 'oxc-blank-space-native.wasip1.cjs'), 'utf8')
  writeFileSync(
    join(dist, 'wasm/oxc-blank-space-native.wasip1.cjs'),
    loader.replaceAll(
      '\'oxc-blank-space-native.wasm32-wasip1.wasm\'',
      '\'../oxc-blank-space-native.wasm32-wasip1.wasm\'',
    ),
  )
}

mkdirSync(dist, { recursive: true })

if (prebuilt) {
  placeWasmStaging(prebuilt)
}
else {
  mkdirSync(binaries, { recursive: true })
  execSync('pnpm build:native', { cwd: root, stdio: 'inherit' })
  execSync('pnpm build:wasm', { cwd: root, stdio: 'inherit' })
}

execSync('pnpm build:js', { cwd: root, stdio: 'inherit' })

if (prebuilt) {
  collectBinaries(prebuilt)
  placeWasmAssets(prebuilt)
}
else {
  collectBinaries(binaries)
  placeWasmAssets(join(root, 'wasm'))
}
