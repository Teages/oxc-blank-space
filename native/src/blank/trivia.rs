//! Exact token lookups by source offset. The parser collects the full token
//! stream (`TokensParserConfig`) in the same pass as parsing; comments are not
//! tokens, so they are transparent to every lookup here.

use std::cell::Cell;

use oxc_parser::{Kind, Token};
use oxc_span::Span;

pub struct TokenIndex<'a> {
    src: &'a str,
    tokens: &'a [Token],
    /// Index hint for the next lookup. Walk queries cluster in source order,
    /// so a galloping search from the last hit amortizes to near-zero.
    hint: Cell<usize>,
}

impl<'a> TokenIndex<'a> {
    pub fn new(src: &'a str, tokens: &'a [Token]) -> Self {
        Self {
            src,
            tokens,
            hint: Cell::new(0),
        }
    }

    /// Partition point of a monotone predicate over the token slice, searched
    /// by galloping outward from the last lookup hint before falling back to a
    /// binary search inside the bracketed window.
    fn partition_point_hinted(&self, pred: impl Fn(&Token) -> bool, hint: usize) -> usize {
        let n = self.tokens.len();
        let probe = hint.min(n);
        let mut lower;
        let mut upper;
        if probe < n && pred(&self.tokens[probe]) {
            // boundary is in (probe, n]: gallop forward
            lower = probe + 1;
            let mut step = 1;
            loop {
                let next = probe + step;
                if next >= n {
                    upper = n;
                    break;
                }
                if pred(&self.tokens[next]) {
                    lower = next + 1;
                    step *= 2;
                } else {
                    upper = next;
                    break;
                }
            }
        } else {
            // boundary is in [0, probe]: gallop backward
            upper = probe;
            let mut step = 1;
            loop {
                if probe < step {
                    lower = 0;
                    break;
                }
                let prev = probe - step;
                if pred(&self.tokens[prev]) {
                    lower = prev + 1;
                    break;
                }
                upper = prev;
                step *= 2;
            }
        }
        lower + self.tokens[lower..upper].partition_point(pred)
    }

    /// Whether [start, end) contains a line terminator.
    pub fn spans_lines(&self, start: u32, end: u32) -> bool {
        start < end && self.src[start as usize..end as usize].contains('\n')
    }

    /// First token whose start offset is at or after `pos`.
    pub fn token_from(&self, pos: u32) -> Option<&'a Token> {
        let index = self.partition_point_hinted(|t| t.start() < pos, self.hint.get());
        self.hint.set(index);
        self.tokens.get(index)
    }

    /// Last token that ends at or before `pos`.
    pub fn token_before(&self, pos: u32) -> Option<&'a Token> {
        let count = self.partition_point_hinted(|t| t.end() <= pos, self.hint.get());
        self.hint.set(count);
        count.checked_sub(1).and_then(|i| self.tokens.get(i))
    }

    /// Span of the `marker` token directly before `anchor`; only trivia may
    /// sit between them, which token adjacency guarantees.
    pub fn marker_before(&self, anchor: u32, marker: Kind) -> Option<Span> {
        let token = self.token_before(anchor)?;
        (token.kind() == marker).then(|| token.span())
    }

    /// Whether the text in [start, end) ends with `;` or a same-line `;`
    /// directly follows it. Statement spans do not include the trailing
    /// semicolon, so callers must also look at what comes after.
    pub fn ends_with_semicolon(&self, start: u32, end: u32) -> bool {
        if let Some(token) = self.token_before(end)
            && token.kind() == Kind::Semicolon
            && token.end() == end
            && token.start() >= start
        {
            return true;
        }
        if let Some(token) = self.token_from(end)
            && token.kind() == Kind::Semicolon
            && !self.spans_lines(end, token.start())
        {
            return true;
        }
        false
    }
}
