import type { LoadFnOutput, LoadHookContext, ResolveFnOutput, ResolveHookContext } from 'node:module'
import type { UnsupportedSyntax } from './types'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { transpileSync } from './index'

/** Extensions whose modules petrea strips before Node parses them. */
const STRIPPED_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

/**
 * `import`/`export` starting a line. Both keywords are fully reserved, so a
 * match outside a string or template literal can only be module syntax;
 * `import(` and `import.meta` are deliberately excluded because dynamic
 * import is valid CommonJS too.
 */
const ESM_SYNTAX = /^[ \t]*(?:import[\s'"{]|import\.meta|export[\s{*])/m

/**
 * `import`/`export` statements survive stripping only when they carry runtime
 * meaning, so the raw file is a good enough oracle — the one divergence from
 * sniffing the stripped output (`export type` lines) still yields a module
 * that parses, which is the safer of the two failures.
 */
function looksLikeEsm(source: string): boolean {
  return ESM_SYNTAX.test(source)
}

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
 * The module format Node should compile a stripped file as. `.mts`/`.cts`
 * carry their format in the extension; for `.ts`/`.tsx` an explicit
 * package.json `type` wins and otherwise module syntax decides, mirroring
 * Node's own module detection. Cached so the resolve and load hooks — which
 * both need it — read and classify each file once.
 */
const formatCache = new Map<string, 'module' | 'commonjs'>()

function moduleFormat(path: string): 'module' | 'commonjs' {
  let format = formatCache.get(path)
  if (format === undefined) {
    switch (extname(path)) {
      case '.mts':
        format = 'module'
        break
      case '.cts':
        format = 'commonjs'
        break
      default: {
        const declared = packageType(dirname(path))
        format = declared ?? (looksLikeEsm(readFileSync(path, 'utf8')) ? 'module' : 'commonjs')
      }
    }
    formatCache.set(path, format)
  }
  return format
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

/**
 * Claim strippable files during resolution and hand Node their format
 * outright: without an explicit format, Node's own extension table rejects
 * `.ts` before the load hook ever runs on versions without native type
 * stripping. Extensionless specifiers and directory imports stay with the
 * default resolver — explicit extensions are required, matching Node's own
 * stripped-TypeScript rules.
 */
export function resolveTypeScript(
  specifier: string,
  context: ResolveHookContext,
  nextResolve: (specifier: string, context?: Partial<ResolveHookContext>) => ResolveFnOutput | Promise<ResolveFnOutput>,
): ResolveFnOutput | Promise<ResolveFnOutput> {
  const url = specifierFileUrl(specifier, context.parentURL)
  if (url !== undefined) {
    const path = strippablePath(url)
    if (path !== undefined) {
      return { url, format: moduleFormat(path), shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
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
  const input = readFileSync(path, 'utf8')
  const source = transpileSync(input, {
    filename: path,
    lang: extname(path) === '.tsx' ? 'tsx' : 'ts',
    onError: node => warnUnsupported(path, input, node),
  })
  return { format: moduleFormat(path), source, shortCircuit: true }
}
