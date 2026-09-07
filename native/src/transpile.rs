//! Port of `src/index.ts` — parse + blank pipeline.

use std::sync::OnceLock;

use oxc_allocator::{Allocator, AllocatorPool};
use oxc_parser::config::TokensParserConfig;
use oxc_parser::Parser;
use oxc_span::SourceType;

/// Arena pool shared by sync and async calls (the async entry runs on the
/// libuv thread pool, so concurrent transpiles must not share one arena).
/// Reusing arenas keeps the parser from re-faulting fresh memory on every
/// call.
pub(crate) fn allocator_pool() -> &'static AllocatorPool {
    static POOL: OnceLock<AllocatorPool> = OnceLock::new();
    POOL.get_or_init(|| {
        let threads = std::thread::available_parallelism().map_or(4, |n| n.get());
        AllocatorPool::new(threads)
    })
}

use crate::blanker::UnsupportedSyntax;
use crate::walk::blank_program;

pub struct TranspileOutput {
    pub code: String,
    pub unsupported: Vec<UnsupportedSyntax>,
}

/// Replace TypeScript-only syntax with whitespace, keeping the remaining
/// JavaScript byte-for-byte at its original line and column positions.
///
/// Runtime TypeScript features (enums, namespaces with runtime code, parameter
/// properties, `export =`, `import x = require(...)` and `<T>expr` assertions)
/// cannot be blanked: they are kept verbatim and reported through
/// `TranspileOutput::unsupported`. Inputs that are not valid TypeScript —
/// including `as`/`satisfies` erasures that would change operator grouping,
/// which TypeScript itself rejects — return an error.
pub fn transpile(input: &str, filename: &str) -> Result<TranspileOutput, String> {
    let allocator_guard = allocator_pool().get();
    let allocator: &Allocator = &allocator_guard;
    let source_type = SourceType::from_path(filename)
        .unwrap_or_else(|_| SourceType::ts())
        .with_module(true);
    let return_value = Parser::new(allocator, input, source_type)
        .with_config(TokensParserConfig)
        .parse();

    // Hard parse failures leave no usable AST: the input is not valid
    // TypeScript, so surface it as a syntax error rather than silently
    // passing TypeScript through as if it were JavaScript. (Soft parse
    // errors still produce a recovered AST, which we process like
    // ts-blank-space does for TypeScript's recovered trees.)
    if return_value.program.body.is_empty()
        && return_value.program.directives.is_empty()
        && return_value.diagnostics.has_errors()
    {
        let details = return_value
            .diagnostics
            .iter()
            .map(|d| d.message.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!("failed to parse {filename}:\n{details}"));
    }

    let (code, unsupported) = blank_program(&return_value.program, input, &return_value.tokens);
    Ok(TranspileOutput { code, unsupported })
}

/// [`transpile`] with panic containment: a bug in an untested AST corner must
/// surface as a JS exception, not abort the process (napi does not catch
/// unwinds by default, for either the sync binding or async task compute).
pub fn transpile_caught(input: &str, filename: &str) -> Result<TranspileOutput, String> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| transpile(input, filename)))
        .unwrap_or_else(|payload| {
            let detail = payload
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| payload.downcast_ref::<&'static str>().map(|s| (*s).to_string()))
                .unwrap_or_else(|| "panic".to_string());
            Err(format!("internal error: {detail}"))
        })
        .and_then(Ok)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blanks_marker_between_comments() {
        // The `?`/`!` marker sits between two comments; locating it requires
        // the trivia scanner to hop over the trailing comment.
        let output = transpile("class C { private f2/**/!/**/: string; }", "input.ts").unwrap();
        assert_eq!(output.code, "class C {         f2/**/ /**/        ; }");
    }

    #[test]
    fn reports_and_rejects() {
        let output = transpile("class C { constructor(private a: string) {} }", "input.ts").unwrap();
        assert_eq!(output.unsupported.len(), 1);
        assert_eq!(output.unsupported[0].node_type, "TSParameterProperty");

        assert!(transpile("1 + 1 as T / 2;", "input.ts").is_err());
    }
}
