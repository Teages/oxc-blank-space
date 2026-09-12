use std::sync::OnceLock;

use oxc_allocator::{Allocator, AllocatorPool};
use oxc_diagnostics::NamedSource;
use oxc_parser::Parser;
use oxc_parser::config::TokensParserConfig;
use oxc_span::SourceType;

/// Shared arena pool. The async entry runs on the libuv thread pool, so
/// concurrent transpiles must not share one arena; reuse keeps the parser
/// from re-faulting fresh memory on every call.
pub(crate) fn allocator_pool() -> &'static AllocatorPool {
    static POOL: OnceLock<AllocatorPool> = OnceLock::new();
    POOL.get_or_init(|| {
        let threads = std::thread::available_parallelism().map_or(4, |n| n.get());
        AllocatorPool::new(threads)
    })
}

use crate::blank::blanker::UnsupportedSyntax;
use crate::visit::walk::{blank_program, blank_program_utf16};

pub struct TranspileOutput {
    pub code: String,
    pub unsupported: Vec<UnsupportedSyntax>,
}

/// UTF-16 path output: code units, with report offsets already UTF-16 code units.
pub struct TranspileUnitsOutput {
    pub code: Vec<u16>,
    pub unsupported: Vec<UnsupportedSyntax>,
}

/// Replace TypeScript-only syntax with whitespace, keeping the remaining
/// JavaScript byte-for-byte at its original line and column positions.
///
/// Runtime TypeScript (enums, namespaces with runtime code, parameter
/// properties, `export =`, `import x = require(...)`, `<T>expr`) is kept
/// verbatim and reported through `TranspileOutput::unsupported`. Inputs that
/// are not valid TypeScript — including `as`/`satisfies` erasures that would
/// change operator grouping, which TypeScript itself rejects — return an error.
pub fn transpile(input: &str, filename: &str) -> Result<TranspileOutput, String> {
    let allocator_guard = allocator_pool().get();
    let allocator: &Allocator = &allocator_guard;
    // unknown/no extension falls back to plain JavaScript (module, no JSX):
    // TypeScript syntax fails there instead of parsing as TS
    let source_type = SourceType::from_path(filename)
        .unwrap_or_else(|_| SourceType::mjs())
        .with_module(true);
    let return_value = Parser::new(allocator, input, source_type)
        .with_config(TokensParserConfig)
        .parse();

    // Hard parse failures leave no usable AST — surface them as a syntax error
    // instead of silently passing TypeScript through. Soft errors still produce
    // a recovered AST, which is processed like any other.
    if return_value.program.body.is_empty()
        && return_value.program.directives.is_empty()
        && return_value.diagnostics.has_errors()
    {
        let details = return_value
            .diagnostics
            .iter()
            .map(|d| {
                d.clone()
                    .render_with_source_code(NamedSource::new(filename, input.to_string()))
            })
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!("failed to parse {filename}:\n{details}"));
    }

    let (code, unsupported) = blank_program(&return_value.program, input, &return_value.tokens);
    Ok(TranspileOutput { code, unsupported })
}

/// Lossless UTF-16 variant of [`transpile`]: the parser works on a lossy UTF-8
/// copy (raw lone surrogates cannot exist in Rust strings), but every output
/// unit is taken from the original units, so raw lone surrogates survive.
/// Report offsets are UTF-16 code units.
pub fn transpile_units(units: &[u16], filename: &str) -> Result<TranspileUnitsOutput, String> {
    // Lossy parse copy: pairs become the astral character, every other unit
    // maps to itself when possible, U+FFFD otherwise; the byte length per
    // unit is tracked so spans can be mapped back.
    let mut copy: Vec<u8> = Vec::with_capacity(units.len() * 3);
    let mut byte_to_unit: Vec<u32> = Vec::with_capacity(units.len() + 1);
    let mut index = 0usize;
    while index < units.len() {
        byte_to_unit.push(copy.len() as u32);
        let unit = units[index];
        let is_high = (0xD800..0xDC00).contains(&unit);
        let next_low =
            matches!(units.get(index + 1), Some(next) if (0xDC00..0xE000).contains(next));
        let mut buf = [0u8; 4];
        if is_high && next_low {
            let code =
                0x10000 + (((unit - 0xD800) as u32) << 10) + (units[index + 1] - 0xDC00) as u32;
            copy.extend_from_slice(
                char::from_u32(code)
                    .expect("valid pair")
                    .encode_utf8(&mut buf)
                    .as_bytes(),
            );
            // the low surrogate needs its own map entry or every later unit
            // index shifts by one; the entry points at the middle of the
            // astral char's bytes — no span boundary can land there
            byte_to_unit.push((copy.len() - 2) as u32);
            index += 2;
        } else if unit == 0x0A || unit == 0x0D {
            copy.push(unit as u8);
            index += 1;
        } else {
            let c = char::from_u32(unit as u32).unwrap_or('\u{FFFD}');
            copy.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
            index += 1;
        }
    }
    byte_to_unit.push(copy.len() as u32);
    let parse_copy = String::from_utf8(copy).expect("lossy copy is valid UTF-8");

    let allocator_guard = allocator_pool().get();
    let allocator: &Allocator = &allocator_guard;
    // same extension fallback as [`transpile`]
    let source_type = SourceType::from_path(filename)
        .unwrap_or_else(|_| SourceType::mjs())
        .with_module(true);
    let return_value = Parser::new(allocator, &parse_copy, source_type)
        .with_config(TokensParserConfig)
        .parse();

    if return_value.program.body.is_empty()
        && return_value.program.directives.is_empty()
        && return_value.diagnostics.has_errors()
    {
        // codeframes render against the lossy copy (lone surrogates were already replaced there)
        let details = return_value
            .diagnostics
            .iter()
            .map(|d| {
                d.clone()
                    .render_with_source_code(NamedSource::new(filename, parse_copy.clone()))
            })
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!("failed to parse {filename}:\n{details}"));
    }

    let (code_units, unsupported) = blank_program_utf16(
        &return_value.program,
        units,
        &parse_copy,
        &byte_to_unit,
        &return_value.tokens[..],
    );

    let unit_at = |pos: u32| byte_to_unit.partition_point(|&b| b < pos) as u32;
    let unsupported = unsupported
        .into_iter()
        .map(|report| UnsupportedSyntax {
            start: unit_at(report.start),
            end: unit_at(report.end),
            ..report
        })
        .collect();

    Ok(TranspileUnitsOutput {
        code: code_units,
        unsupported,
    })
}

/// [`transpile_units`] with panic containment (see [`transpile_caught`]).
pub fn transpile_units_caught(
    units: &[u16],
    filename: &str,
) -> Result<TranspileUnitsOutput, String> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        transpile_units(units, filename)
    })) {
        Ok(result) => result,
        Err(payload) => {
            let detail = payload
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| {
                    payload
                        .downcast_ref::<&'static str>()
                        .map(|s| (*s).to_string())
                })
                .unwrap_or_else(|| "panic".to_string());
            Err(format!("internal error: {detail}"))
        }
    }
}

/// [`transpile`] with panic containment: a bug in an untested AST corner must
/// surface as a JS exception, not abort the process — napi does not catch
/// unwinds by default, for the sync binding or async task compute alike.
pub fn transpile_caught(input: &str, filename: &str) -> Result<TranspileOutput, String> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| transpile(input, filename))) {
        Ok(result) => result,
        Err(payload) => {
            let detail = payload
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| {
                    payload
                        .downcast_ref::<&'static str>()
                        .map(|s| (*s).to_string())
                })
                .unwrap_or_else(|| "panic".to_string());
            Err(format!("internal error: {detail}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blanks_marker_between_comments() {
        // the `?`/`!` marker sits between two comments; locating it hops the trailing comment
        let output = transpile("class C { private f2/**/!/**/: string; }", "input.ts").unwrap();
        assert_eq!(output.code, "class C {         f2/**/ /**/        ; }");
    }

    #[test]
    fn reports_and_rejects() {
        let output =
            transpile("class C { constructor(private a: string) {} }", "input.ts").unwrap();
        assert_eq!(output.unsupported.len(), 1);
        assert_eq!(output.unsupported[0].node_type, "TSParameterProperty");

        assert!(transpile("1 + 1 as T / 2;", "input.ts").is_err());
    }
}
