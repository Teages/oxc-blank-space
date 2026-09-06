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

fn to_napi_result(
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
                start: report.start,
                end: report.end,
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
        to_napi_result(transpile::transpile(&self.input, &self.filename))
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
    to_napi_result(transpile::transpile(&input, &filename))
}
