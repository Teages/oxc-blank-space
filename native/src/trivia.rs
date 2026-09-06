//! Port of `src/core/trivia.ts`.
//!
//! Trivia (whitespace and comment) navigation over the source text, operating
//! on UTF-8 byte offsets (oxc spans).
//!
//! The oxc AST only exposes token-anchored spans, so several erased markers
//! (`?`, `!`, modifier keywords, `implements`, the `(` moved out of multi-line
//! generic parameter lists) have to be located by scanning past trivia.

use std::collections::HashMap;

fn is_whitespace_code(code: u8) -> bool {
    matches!(code, 32 | 9 | 10 | 13 | 11 | 12)
}

/// `[\w$]` on a single byte — `\w` is `[A-Za-z0-9_]`, and multi-byte UTF-8
/// bytes never compare equal to ASCII, so byte-level checks match the JS regex.
pub fn is_word_char(code: u8) -> bool {
    code.is_ascii_alphanumeric() || code == b'_' || code == b'$'
}

pub struct Trivia<'a> {
    src: &'a str,
    /// Comment end offset -> comment start offset.
    comment_ending_at: HashMap<u32, u32>,
}

impl<'a> Trivia<'a> {
    pub fn new(src: &'a str, comment_spans: impl IntoIterator<Item = (u32, u32)>) -> Self {
        Self {
            src,
            comment_ending_at: comment_spans.into_iter().collect(),
        }
    }

    /// First character offset at or after `pos` that is not trivia.
    pub fn skip_forward(&self, pos: u32, stop_at_newline: bool) -> u32 {
        let bytes = self.src.as_bytes();
        let mut pos = pos;
        loop {
            if pos as usize >= bytes.len() {
                return bytes.len() as u32;
            }
            let code = bytes[pos as usize];
            if is_whitespace_code(code) {
                if stop_at_newline && (code == b'\n' || code == b'\r') {
                    return pos;
                }
                pos += 1;
                continue;
            }
            if code == b'/' && bytes.get(pos as usize + 1) == Some(&b'/') {
                let rest = &self.src[pos as usize..];
                let end = match (rest.find('\n'), rest.find('\r')) {
                    (None, None) => bytes.len() as u32,
                    (Some(n), Some(c)) => pos + n.min(c) as u32,
                    (Some(n), None) => pos + n as u32,
                    (None, Some(c)) => pos + c as u32,
                };
                if stop_at_newline {
                    return end;
                }
                pos = end + 1;
                continue;
            }
            if code == b'/' && bytes.get(pos as usize + 1) == Some(&b'*') {
                let end = self.src[pos as usize + 2..]
                    .find("*/")
                    .map_or(bytes.len() as u32, |i| pos + 2 + i as u32 + 2);
                pos = end;
                continue;
            }
            return pos;
        }
    }

    /// Offset of the first non-trivia character strictly before `pos`, or `-1`
    /// when `pos` is preceded only by trivia.
    pub fn skip_backward(&self, pos: u32) -> i64 {
        let mut pos = pos as i64;
        loop {
            if pos <= 0 {
                return -1;
            }
            let code = self.src.as_bytes()[(pos - 1) as usize];
            if is_whitespace_code(code) {
                pos -= 1;
                continue;
            }
            if let Some(&start) = self.comment_ending_at.get(&(pos as u32)) {
                pos = start as i64;
                continue;
            }
            return pos - 1;
        }
    }

    /// Whether [start, end) contains a line terminator.
    pub fn spans_lines(&self, start: u32, end: u32) -> bool {
        self.src[start as usize..end as usize].contains('\n')
    }

    /// Offset of the word starting at or after `pos`, together with its text.
    /// `None` when no word follows (only trivia).
    pub fn scan_word(&self, pos: u32) -> Option<(u32, &'a str)> {
        let start = self.skip_forward(pos, false);
        let bytes = self.src.as_bytes();
        if start as usize >= bytes.len() || !is_word_char(bytes[start as usize]) {
            return None;
        }
        let mut end = start;
        while (end as usize) < bytes.len() && is_word_char(bytes[end as usize]) {
            end += 1;
        }
        Some((start, &self.src[start as usize..end as usize]))
    }

    /// Offset of the first non-trivia character at or after `pos`.
    pub fn scan_char(&self, pos: u32) -> u32 {
        self.skip_forward(pos, false)
    }

    /// Byte at `pos`, if any (mirrors `src[pos]` being `undefined` in JS).
    pub fn byte_at(&self, pos: u32) -> Option<u8> {
        self.src.as_bytes().get(pos as usize).copied()
    }

    /// Whether the node text ends with `;` or a same-line `;` immediately
    /// follows it. The TypeScript AST includes trailing semicolons in statement
    /// spans while oxc does not, so callers checking "did the emitted code end
    /// with a semicolon" need this parity helper.
    pub fn ends_with_semicolon(&self, start: u32, end: u32) -> bool {
        if start < end && self.byte_at(end - 1) == Some(b';') {
            return true;
        }
        let next = self.skip_forward(end, true);
        self.byte_at(next) == Some(b';')
    }
}
