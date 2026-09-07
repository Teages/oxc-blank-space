//! Native Rust implementation of `@teages/oxc-blank-space`.
//!
//! Exposes the async entry point used by
//! `@teages/oxc-blank-space/experimental-native`: parsing and blanking run on
//! a background thread (napi `AsyncTask`) and resolve with the output plus the
//! list of unsupported constructs. A synchronous variant is also exposed for
//! benchmarking the raw Rust speed without the thread-pool hop.

/// Flat index of a concrete AST node; assigned during the flatten pass in
/// `walk::blank_program` (visible crate-wide, must stay above the `mod` items).
macro_rules! node_index {
    ($n:expr) => {
        $n.node_id.get().index() as u32
    };
}

mod blank_string;
mod blanker;
mod class;
mod enum_exp;
mod expression;
mod function;
mod namespace;
mod pattern;
mod precedence;
mod statement;
mod transpile;
mod trivia;
mod walk;

use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;

/// Options accepted by the native bindings. `onError` reporting is returned as
/// data (`TranspileNativeResult::unsupported`) so the background task never
/// needs to call back into JS; the JS wrapper invokes the user callback.
#[napi(object)]
pub struct TranspileNativeOptions {
    /// Parse the input as `ts` (default) or `tsx`.
    pub lang: Option<String>,
    /// Source path quoted in the diagnostics of parse failures; the extension
    /// also selects the parse mode (a `.tsx` filename enables JSX).
    pub filename: Option<String>,
}

/// A TypeScript-only construct with runtime semantics that was kept verbatim.
#[napi(object)]
pub struct NativeUnsupported {
    pub node_type: String,
    pub start: u32,
    pub end: u32,
}

#[napi(object)]
pub struct TranspileNativeResult {
    pub code: String,
    pub unsupported: Vec<NativeUnsupported>,
}

fn resolve_filename(options: Option<&TranspileNativeOptions>) -> String {
    let lang = options.and_then(|o| o.lang.as_deref());
    options
        .and_then(|o| o.filename.clone())
        .unwrap_or_else(|| {
            if lang == Some("tsx") {
                "input.tsx".to_string()
            } else {
                "input.ts".to_string()
            }
        })
}

/// The API contract (`types.ts`) promises character offsets — JS string
/// indices, i.e. UTF-16 code units. Internal spans are UTF-8 bytes; convert
/// so `input.slice(start, end)` slices the same text on both entries.
fn utf16_offset(input: &str, byte_offset: u32) -> u32 {
    if input.is_ascii() {
        return byte_offset;
    }
    let mut offset = byte_offset as usize;
    while offset > 0 && !input.is_char_boundary(offset) {
        offset -= 1;
    }
    input[..offset]
        .chars()
        .map(|c| c.len_utf16() as u32)
        .sum()
}

fn to_napi_result(
    input: &str,
    output: std::result::Result<transpile::TranspileOutput, String>,
) -> Result<TranspileNativeResult> {
    let output = output.map_err(|message| Error::new(Status::GenericFailure, message))?;
    Ok(TranspileNativeResult {
        code: output.code,
        unsupported: output
            .unsupported
            .into_iter()
            .map(|report| NativeUnsupported {
                node_type: report.node_type.to_string(),
                start: utf16_offset(input, report.start),
                end: utf16_offset(input, report.end),
            })
            .collect(),
    })
}

pub struct TranspileTask {
    input: String,
    filename: String,
}

impl Task for TranspileTask {
    type Output = TranspileNativeResult;
    type JsValue = TranspileNativeResult;

    fn compute(&mut self) -> Result<Self::Output> {
        to_napi_result(
            &self.input,
            transpile::transpile_caught(&self.input, &self.filename),
        )
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Async entry point: blank TypeScript-only syntax on a background thread.
/// Resolves with the blanked code plus the list of unsupported constructs;
/// rejects with a `SyntaxError`-message error when the input cannot be parsed.
#[napi(ts_return_type = "Promise<TranspileNativeResult>")]
pub fn transpile_async(
    input: String,
    options: Option<TranspileNativeOptions>,
) -> AsyncTask<TranspileTask> {
    let filename = resolve_filename(options.as_ref());
    AsyncTask::new(TranspileTask { input, filename })
}

/// Synchronous counterpart of `transpile_async`; wrapped by the JS
/// `transpileSync` export.
#[napi]
pub fn transpile_native_sync(
    input: String,
    options: Option<TranspileNativeOptions>,
) -> Result<TranspileNativeResult> {
    let filename = resolve_filename(options.as_ref());
    let input_ref = input.as_str();
    to_napi_result(input_ref, transpile::transpile_caught(&input, &filename))
}

#[cfg(test)]
mod perf_bench {
    //! Internal performance harness — run with:
    //! `cargo test --release perf_bench -- --ignored --nocapture`
    //!
    //! Reports the parse-only floor, the parse+tokens floor, and the full
    //! transpile pipeline over the fixture corpus. Timings are min/mean over
    //! many iterations; use `--release`, debug numbers are meaningless.

    use std::fs;
    use std::time::Instant;

    use oxc_allocator::{Allocator, AllocatorPool};
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    use crate::transpile::allocator_pool;

    fn corpus() -> String {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../test/fixture");
        let mut out = String::new();
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_some_and(|e| e == "ts") {
                out.push_str(&fs::read_to_string(path).unwrap());
                out.push('\n');
            }
        }
        out
    }

    fn parse_only(pool: &AllocatorPool, input: &str, tokens: bool) {
        let guard = pool.get();
        let allocator: &Allocator = &guard;
        let source_type = SourceType::from_path("input.ts").unwrap().with_module(true);
        let parser = Parser::new(allocator, input, source_type);
        let ret = if tokens {
            parser.with_config(oxc_parser::config::TokensParserConfig).parse()
        } else {
            parser.parse()
        };
        std::hint::black_box((ret.program.body.len(), ret.tokens.len()));
    }

    fn time_it<F: FnMut()>(iters: usize, mut f: F) -> (u128, u128) {
        for _ in 0..10 {
            f();
        }
        let mut total = 0u128;
        let mut min = u128::MAX;
        for _ in 0..iters {
            let start = Instant::now();
            f();
            let elapsed = start.elapsed().as_nanos();
            total += elapsed;
            min = min.min(elapsed);
        }
        (min, total / iters as u128)
    }

    #[test]
    #[ignore]
    fn floors_and_pipeline() {
        let original = corpus();
        let mut corpus = original.clone();
        while corpus.len() < 100_000 {
            corpus.push_str(&original);
        }
        println!("input: {} bytes", corpus.len());

        transpile_for_bench(&corpus);

        let iters = 100;
        let pool = allocator_pool();
        let (p_min, p_mean) = time_it(iters, || parse_only(pool, &corpus, false));
        let (pt_min, pt_mean) = time_it(iters, || parse_only(pool, &corpus, true));
        let (t_min, t_mean) = time_it(iters, || { transpile_for_bench(&corpus); });
        println!(
            "parse-only      min={:>5}us mean={:>5}us",
            p_min / 1000, p_mean / 1000
        );
        println!(
            "parse+tokens    min={:>5}us mean={:>5}us",
            pt_min / 1000, pt_mean / 1000
        );
        println!(
            "full transpile  min={:>5}us mean={:>5}us",
            t_min / 1000, t_mean / 1000
        );
    }

    fn transpile_for_bench(input: &str) -> usize {
        let output = crate::transpile::transpile(input, "input.ts").expect("transpiles");
        std::hint::black_box(output.code.len() + output.unsupported.len())
    }
}
mod dtoa_probe;
