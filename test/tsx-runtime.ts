import ts from 'typescript'

/**
 * The runtime-equivalence layer of the tsx matrix: for behavior-carrying
 * cases, the original input and the blanked output are both compiled to
 * executable JavaScript with the TypeScript compiler (classic React emit)
 * and evaluated against a recording JSX factory. The observable element
 * structure and the evaluation trace must be identical — proving erasure
 * changed nothing at runtime, with the reference compiler as the arbiter of
 * the input's semantics.
 */

export interface Evaluation {
  /** values passed through `log`, in evaluation order */
  readonly trace: readonly string[]
  /** the value bound to `el` by the snippet */
  readonly tree: unknown
}

/** Compile a TSX snippet to executable JS with the TypeScript compiler. */
function compileWithTsc(source: string, fileName: string): string {
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ESNext,
    },
    fileName,
    // without this flag the diagnostics array is always empty and inputs the
    // compiler only parses via error recovery would be evaluated silently
    reportDiagnostics: true,
  })
  const errors = diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error)
  if (errors.length > 0) {
    const messages = errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, ' '))
    throw new Error(`typescript failed to compile ${fileName}: ${messages.join('; ')}`)
  }
  return outputText
}

/** Evaluate compiled code against a recording JSX factory and `log`. */
function evaluate(code: string): Evaluation {
  const trace: string[] = []
  const log = (message: string): string => {
    trace.push(message)
    return message
  }
  const React = {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) =>
      ({ children, props, type }),
  }
  // snippets bind `el` (matrix convention); `log` must be reachable from
  // attribute and child expressions to record evaluation order
  const tree = new Function('React', 'log', `${code}; return el;`)(React, log)
  return { trace, tree }
}

/**
 * Compile `source` (valid TSX) with the TypeScript compiler and evaluate it.
 * Throws when the compiler rejects the input — the matrix only feeds it
 * cases the reference compiler accepts.
 */
export function evaluateWithTsc(source: string): Evaluation {
  return evaluate(compileWithTsc(source, 'input.tsx'))
}

/**
 * Compile already-blanked output (valid JSX plus plain JS) with the
 * TypeScript compiler and evaluate it. A `.jsx` file name asserts the
 * output needs no TypeScript syntax to compile.
 */
export function evaluateBlankedWithTsc(output: string): Evaluation {
  return evaluate(compileWithTsc(output, 'output.jsx'))
}
