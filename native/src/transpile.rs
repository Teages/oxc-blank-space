//! Port of `src/index.ts` — parse + blank pipeline.

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

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
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(filename)
        .unwrap_or_else(|_| SourceType::ts())
        .with_module(true);
    let return_value = Parser::new(&allocator, input, source_type).parse();

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

    let (code, unsupported) = blank_program(&return_value.program, input);
    Ok(TranspileOutput { code, unsupported })
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
