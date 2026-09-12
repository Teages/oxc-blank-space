import type { LoadFnOutput, LoadHookContext, ResolveFnOutput, ResolveHookContext } from 'node:module'
import type { UnsupportedSyntax } from './types'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileFunction } from 'node:vm'
import { transpileSync } from './index'

/** Extensions whose modules petrea strips before Node parses them. */
const STRIPPED_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

/** module type declared by the nearest package.json, if any. */
const packageTypeCache = new Map<string, 'module' | 'commonjs' | undefined>()

function packageType(dir: string): 'module' | 'commonjs' | undefined {
  if (packageTypeCache.has(dir)) {
    return packageTypeCache.get(dir)
  }
  let current = dir
  for (;;) {
    const manifest = join(current, 'package.json')
    if (existsSync(manifest)) {
      let type: unknown
      try {
        type = JSON.parse(readFileSync(manifest, 'utf8')).type
      }
      catch {
        // a malformed manifest belongs to the application, not to petrea
        packageTypeCache.set(dir, undefined)
        return undefined
      }
      const declared = type === 'module' || type === 'commonjs' ? type : undefined
      packageTypeCache.set(dir, declared)
      return declared
    }
    const parent = dirname(current)
    if (parent === current) {
      packageTypeCache.set(dir, undefined)
      return undefined
    }
    current = parent
  }
}

/**
 * The format a stripped file compiles as. `.mts`/`.cts` carry their format in
 * the extension; for `.ts`/`.tsx` an explicit package.json `type` wins and
 * otherwise the source syntax decides, mirroring Node's module detection.
 */
function formatOf(path: string, source: string): 'module' | 'commonjs' {
  switch (extname(path)) {
    case '.mts':
      return 'module'
    case '.cts':
      return 'commonjs'
    default:
      return packageType(dirname(path)) ?? probeModuleSyntax(source)
  }
}

// a hashbang may open a script or module but cannot appear inside the
// function body the probe compiles
function withoutHashbang(source: string): string {
  if (!source.startsWith('#!')) {
    return source
  }
  const newline = source.indexOf('\n')
  return newline === -1 ? '' : source.slice(newline + 1)
}

/**
 * Classify stripped source by compile-probing it inside the CommonJS wrapper
 * — the same way Node's own module detection does: the module-only syntax of
 * a file (`import`/`export` statements, `import.meta`, top-level `await`)
 * fails to compile there and selects ESM, while everything CommonJS files
 * legally do — top-level `return`, sloppy-mode syntax, dynamic `import()` —
 * passes and selects CommonJS. Declaring a wrapper parameter such as
 * `require` or `__filename` at the top level also fails the probe and selects
 * ESM, matching the wrapper Node would otherwise compile the file in.
 * Compiling analyses real syntax, so unlike pattern matching it reads module
 * keywords wherever they appear in a line and cannot be fooled by keywords
 * inside comments or strings.
 */
const CJS_WRAPPER_PARAMS = ['exports', 'require', 'module', '__filename', '__dirname']

function probeModuleSyntax(source: string): 'module' | 'commonjs' {
  try {
    compileFunction(withoutHashbang(source), CJS_WRAPPER_PARAMS)
    return 'commonjs'
  }
  catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error
    }
    return 'module'
  }
}

/** Decoded path when the URL points at an existing file petrea strips. */
function strippablePath(url: string): string | undefined {
  try {
    const path = fileURLToPath(url)
    return STRIPPED_EXTENSIONS.has(extname(path)) && existsSync(path) ? path : undefined
  }
  catch {
    return undefined
  }
}

/** File URL for the specifier forms that can only denote a file on disk. */
function specifierFileUrl(specifier: string, parentURL?: string): string | undefined {
  try {
    if (specifier.startsWith('file:')) {
      return new URL(specifier).href
    }
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      return parentURL === undefined ? undefined : new URL(specifier, parentURL).href
    }
    if (specifier.startsWith('/')) {
      return new URL(specifier, parentURL ?? pathToFileURL(`${process.cwd()}/`)).href
    }
  }
  catch {
    return undefined
  }
  return undefined
}

/** 1-based position of a UTF-16 character offset, for warning messages. */
function positionOf(source: string, offset: number): { line: number, column: number } {
  let line = 1
  let column = 1
  for (let index = 0; index < offset && index < source.length; index++) {
    if (source[index] === '\n') {
      line++
      column = 1
    }
    else {
      column++
    }
  }
  return { line, column }
}

/**
 * Constructs petrea reports are written to stderr synchronously: the verbatim
 * syntax usually makes Node throw moments later, and an asynchronous
 * `process.emitWarning` would be lost when the process dies first. The
 * message names the TypeScript feature so the runtime's own error gains
 * context.
 */
function warnUnsupported(filename: string, source: string, node: UnsupportedSyntax): void {
  const { line, column } = positionOf(source, node.start)
  process.stderr.write(
    `petrea: ${node.type} at ${filename}:${line}:${column} has runtime semantics and stays verbatim; the module may fail to parse\n`,
  )
}

interface FileFacts {
  format: 'module' | 'commonjs'
  source: string
}

const factsCache = new Map<string, { mtimeMs: number, facts: FileFacts }>()

/** Strip and classify a file once per mtime revision. */
function fileFacts(path: string): FileFacts {
  const { mtimeMs } = statSync(path)
  const cached = factsCache.get(path)
  if (cached !== undefined && cached.mtimeMs === mtimeMs) {
    return cached.facts
  }
  const input = readFileSync(path, 'utf8')
  const source = transpileSync(input, {
    filename: path,
    lang: extname(path) === '.tsx' ? 'tsx' : 'ts',
    onError: node => warnUnsupported(path, input, node),
  })
  const facts = { format: formatOf(path, source), source }
  factsCache.set(path, { mtimeMs, facts })
  return facts
}

/**
 * Resolve hook shared by the in-thread and threaded registrations. Resolution
 * itself is delegated to Node's default resolver whenever it succeeds — that
 * keeps symlink handling, `--preserve-symlinks` semantics and every specifier
 * form exactly as Node performs them — and strippable results are claimed so
 * the load hook runs for them. Node versions without native TypeScript
 * support reject strippable specifiers inside the default resolver; those
 * fall back to lexical resolution, following symlinks like the default
 * resolution does so relative imports inside a symlinked file keep resolving
 * against its real location.
 */
export function resolveTypeScript(
  specifier: string,
  context: ResolveHookContext,
  nextResolve: (specifier: string, context?: Partial<ResolveHookContext>) => ResolveFnOutput | Promise<ResolveFnOutput>,
): ResolveFnOutput | Promise<ResolveFnOutput> {
  const claim = (result: ResolveFnOutput): ResolveFnOutput => {
    const path = strippablePath(result.url)
    return path === undefined ? result : { ...result, shortCircuit: true }
  }
  const lexical = (resolutionError: unknown): ResolveFnOutput => {
    const url = specifierFileUrl(specifier, context.parentURL)
    if (url !== undefined) {
      const path = strippablePath(url)
      if (path !== undefined) {
        const resolved = preserveSymlinks() ? path : realpathSync(path)
        return {
          url: pathToFileURL(resolved).href,
          format: fileFacts(resolved).format,
          shortCircuit: true,
        }
      }
    }
    throw resolutionError
  }
  try {
    const delegated = nextResolve(specifier, context)
    return delegated instanceof Promise
      ? delegated.then(claim, lexical)
      : claim(delegated)
  }
  catch (error) {
    return lexical(error)
  }
}

function preserveSymlinks(): boolean {
  return process.execArgv.includes('--preserve-symlinks')
}

/**
 * Load hook shared by the in-thread and threaded registrations: strip
 * strippable files, delegate everything else. Synchronous by design — the
 * threaded wrapper's async signature simply flattens the delegated promise.
 */
export function loadTypeScript(
  url: string,
  context: LoadHookContext,
  nextLoad: (url: string, context?: Partial<LoadHookContext>) => LoadFnOutput | Promise<LoadFnOutput>,
): LoadFnOutput | Promise<LoadFnOutput> {
  if (!url.startsWith('file:')) {
    return nextLoad(url, context)
  }
  const path = strippablePath(url)
  if (path === undefined) {
    return nextLoad(url, context)
  }
  const { format, source } = fileFacts(path)
  return { format, source, shortCircuit: true }
}
