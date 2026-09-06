//! Port of `src/core/blanker.ts` — per-run state plus the primitive blanking
//! operations. The walk logic lives in `walk.rs` and friends; they coordinate
//! through an instance of this struct.

use oxc_parser::{Kind, Token};
use oxc_span::Span;

use crate::blank_string::BlankString;
use crate::trivia::TokenIndex;

/// Information about a TypeScript-only construct that has runtime semantics
/// and therefore cannot be erased. Positions are byte offsets into the input.
#[derive(Debug, Clone)]
pub struct UnsupportedSyntax {
    pub node_type: &'static str,
    pub start: u32,
    pub end: u32,
}

pub struct Blanker<'a> {
    pub output: BlankString,
    pub tokens: TokenIndex<'a>,
    /// True while the previously emitted JS did not end with a `;`.
    pub semicolon_needed: bool,
    /// Unsupported constructs reported so far.
    pub reports: Vec<UnsupportedSyntax>,
}

impl<'a> Blanker<'a> {
    pub fn new(src: &'a str, tokens: &'a [Token]) -> Self {
        Self {
            output: BlankString::default(),
            tokens: TokenIndex::new(src, tokens),
            semicolon_needed: false,
            reports: Vec::new(),
        }
    }

    /// Report an unsupported construct; its source stays in the output.
    pub fn report(&mut self, node_type: &'static str, span: Span) {
        self.reports.push(UnsupportedSyntax {
            node_type,
            start: span.start,
            end: span.end,
        });
    }

    pub fn blank_range(&mut self, start: u32, end: u32) {
        self.output.blank(start, end);
    }

    /// Blank [span.start, span.end).
    pub fn blank_span(&mut self, span: Span) {
        self.output.blank(span.start, span.end);
    }

    /// Blank [span.start, span.end).
    pub fn blank_exact(&mut self, span: Span) {
        self.output.blank(span.start, span.end);
    }

    /// Blank a statement-like node that is being fully erased. A leading `;` is
    /// emitted when the previous emitted JS lacks one, so that a following
    /// statement cannot merge into it (ASI protection).
    pub fn blank_statement(&mut self, span: Span) {
        if self.semicolon_needed {
            self.output.blank_but_start_with_semi(span.start, span.end);
        } else {
            self.output.blank(span.start, span.end);
        }
    }

    /// Blank a `: T` type annotation; oxc spans include the colon.
    pub fn blank_type_annotation(&mut self, span: Span) {
        self.output.blank(span.start, span.end);
    }

    /// Blank a node and, when directly followed by a comma, the comma too.
    pub fn blank_exact_and_optional_trailing_comma(&mut self, span: Span) {
        let end = match self.tokens.token_from(span.end) {
            Some(token) if token.kind() == Kind::Comma => token.span().end,
            _ => span.end,
        };
        self.output.blank(span.start, end);
    }

    /// Whether the node text ends with `;` or a same-line `;` directly follows
    /// it.
    pub fn ends_with_semicolon(&self, span: Span) -> bool {
        self.tokens.ends_with_semicolon(span.start, span.end)
    }

    /// Erase the marker token (`?` or `!`) sitting directly before `anchor`.
    pub fn blank_marker_char(&mut self, anchor: u32, marker: Kind) {
        if let Some(span) = self.tokens.marker_before(anchor, marker) {
            self.output.blank(span.start, span.end);
        }
    }
}
