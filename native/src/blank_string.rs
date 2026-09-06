//! Port of `src/core/blank-string.ts`.

const REPLACE_WITH_BLANK: u8 = 0;
const REPLACE_WITH_OPEN_PAREN: u8 = 1;
const REPLACE_WITH_CLOSE_PAREN: u8 = 2;
const REPLACE_WITH_SEMI: u8 = 3;
const REPLACE_WITH_TEXT: u8 = 4;

/// Like magic-string but with only two features: blanking ranges (preserving
/// newlines so line/column numbers stay stable) and overwriting ranges with
/// literal text (may change the output length, used for enum expansion and
/// grouping parens).
#[derive(Default)]
pub struct BlankString {
    /// Flat (flags, start, end, textIndex) tuples, pushed in source order.
    ranges: Vec<(u8, u32, u32, u32)>,
    texts: Vec<String>,
}

impl BlankString {
    /// Replace [start, end) with `text`; `end` may equal `start` to insert.
    pub fn override_range(&mut self, start: u32, end: u32, text: impl Into<String>) {
        let index = self.texts.len() as u32;
        self.texts.push(text.into());
        self.ranges.push((REPLACE_WITH_TEXT, start, end, index));
    }

    pub fn blank_but_start_with_open_paren(&mut self, start: u32, end: u32) {
        self.ranges.push((REPLACE_WITH_OPEN_PAREN, start, end, u32::MAX));
    }

    pub fn blank_but_end_with_close_paren(&mut self, start: u32, end: u32) {
        self.ranges.push((REPLACE_WITH_BLANK, start, end - 1, u32::MAX));
        self.ranges
            .push((REPLACE_WITH_CLOSE_PAREN, end - 1, end, u32::MAX));
    }

    pub fn blank_but_start_with_semi(&mut self, start: u32, end: u32) {
        self.ranges.push((REPLACE_WITH_SEMI, start, end, u32::MAX));
    }

    pub fn blank(&mut self, start: u32, end: u32) {
        self.ranges.push((REPLACE_WITH_BLANK, start, end, u32::MAX));
    }

    pub fn build(&self, input: &str) -> String {
        let ranges = &self.ranges;
        if ranges.is_empty() {
            return input.to_string();
        }

        let mut out = String::with_capacity(input.len());
        let mut previous_end = 0u32;

        for &(flags, start, end, text_index) in ranges {
            let range_start = start.max(previous_end);
            out.push_str(&input[previous_end as usize..range_start as usize]);

            let mut range_start = range_start;
            match flags {
                REPLACE_WITH_TEXT => out.push_str(&self.texts[text_index as usize]),
                REPLACE_WITH_CLOSE_PAREN => {
                    out.push(')');
                    range_start += 1;
                }
                REPLACE_WITH_SEMI => {
                    out.push(';');
                    range_start += 1;
                }
                REPLACE_WITH_OPEN_PAREN => {
                    out.push('(');
                    range_start += 1;
                }
                _ => {}
            }

            previous_end = end;
            if flags != REPLACE_WITH_TEXT {
                out.push_str(&get_space(input, range_start, previous_end));
            }
        }

        out.push_str(&input[previous_end as usize..]);
        out
    }
}

/// Preserve every newline inside [start, end) and replace everything else with
/// spaces, one per UTF-16 code unit (matching the JS implementation, which
/// blanks one space per `charCodeAt` unit — a non-BMP char becomes 2 spaces).
///
/// Ranges pushed out of source order (a blank nested inside an already-blanked
/// region) yield an empty replacement here, matching the JS loop which never
/// enters its body when `start >= end`.
fn get_space(input: &str, start: u32, end: u32) -> String {
    if start >= end {
        return String::new();
    }
    let mut out = String::new();
    for c in input[start as usize..end as usize].chars() {
        match c {
            '\n' => out.push('\n'),
            '\r' => out.push('\r'),
            _ => {
                for _ in 0..c.len_utf16() {
                    out.push(' ');
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_preserves_newlines_and_length() {
        let input = "const a: number = 1";
        let mut bs = BlankString::default();
        // Blank the `: number` annotation (8 chars, no newlines).
        bs.blank(7, 15);
        assert_eq!(bs.build(input), format!("const a{} = 1", " ".repeat(8)));
    }

    #[test]
    fn no_ranges_returns_input() {
        let bs = BlankString::default();
        assert_eq!(bs.build("abc"), "abc");
    }
}
