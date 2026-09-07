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

    /// Splice into a single exactly-sized buffer: untouched regions are copied
    /// verbatim, blanks become newline-preserving space runs, and the extra
    /// capacity needed by text overrides is computed up front so the whole
    /// output is built with one allocation.
    pub fn build(&self, input: &str) -> String {
        let ranges = &self.ranges;
        if ranges.is_empty() {
            return input.to_string();
        }

        let mut extra = 0usize;
        for &(flags, start, end, text_index) in ranges {
            if flags == REPLACE_WITH_TEXT {
                let len = self.texts[text_index as usize].len();
                extra += len.saturating_sub((end - start) as usize);
            }
        }

        let mut out = Vec::with_capacity(input.len() + extra);
        let mut previous_end = 0u32;

        for &(flags, start, end, text_index) in ranges {
            let range_start = start.max(previous_end);
            out.extend_from_slice(&input.as_bytes()[previous_end as usize..range_start as usize]);

            let mut range_start = range_start;
            match flags {
                REPLACE_WITH_TEXT => {
                    out.extend_from_slice(self.texts[text_index as usize].as_bytes())
                }
                REPLACE_WITH_CLOSE_PAREN => {
                    out.push(b')');
                    range_start += 1;
                }
                REPLACE_WITH_SEMI => {
                    out.push(b';');
                    range_start += 1;
                }
                REPLACE_WITH_OPEN_PAREN => {
                    out.push(b'(');
                    range_start += 1;
                }
                _ => {}
            }

            previous_end = end;
            if flags != REPLACE_WITH_TEXT {
                write_space(&mut out, input, range_start, previous_end);
            }
        }

        out.extend_from_slice(&input.as_bytes()[previous_end as usize..]);
        // ranges only ever contain the input, spaces, and caller-provided text
        // (all UTF-8), so the buffer is valid UTF-8 by construction.
        // SAFETY-free variant: String::from_utf8 checked in debug builds.
        String::from_utf8(out).expect("output buffer is valid UTF-8")
    }
}

/// Preserve every newline inside [start, end) and replace everything else with
/// spaces, one per UTF-16 code unit (matching the JS implementation, which
/// blanks one space per `charCodeAt` unit — a non-BMP char becomes 2 spaces).
///
/// Ranges pushed out of source order (a blank nested inside an already-blanked
/// region) write nothing here, matching the JS loop which never enters its
/// body when `start >= end`.
fn write_space(out: &mut Vec<u8>, input: &str, start: u32, end: u32) {
    if start >= end {
        return;
    }
    let bytes = &input.as_bytes()[start as usize..end as usize];
    if bytes.is_ascii() {
        // Fast path: an ASCII byte maps to itself for newlines and to one
        // space for everything else.
        for &b in bytes {
            out.push(if b == b'\n' || b == b'\r' { b } else { b' ' });
        }
        return;
    }
    for c in input[start as usize..end as usize].chars() {
        match c {
            '\n' => out.push(b'\n'),
            '\r' => out.push(b'\r'),
            _ => {
                for _ in 0..c.len_utf16() {
                    out.push(b' ');
                }
            }
        }
    }
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

impl BlankString {
    /// UTF-16 variant of [`build`](Self::build) for the lossless UTF-16 path:
    /// the input is the original code units, `byte_to_unit` maps every parse
    /// copy byte offset to its unit index (strictly increasing), and the
    /// result is the output in code units. Blanked ranges preserve newline
    /// units and replace every other unit (including lone surrogates) with a
    /// single space — matching the JS implementation's per-code-unit blanking.
    pub fn build_units(
        &self,
        units: &[u16],
        byte_to_unit: &[u32],
    ) -> Vec<u16> {
        if self.ranges.is_empty() {
            return units.to_vec();
        }
        let unit_at = |pos: u32| byte_to_unit.partition_point(|&b| b < pos);

        let mut extra = 0usize;
        for &(flags, start, end, text_index) in &self.ranges {
            if flags == REPLACE_WITH_TEXT {
                let len = self.texts[text_index as usize].encode_utf16().count();
                let u0 = unit_at(start);
                let u1 = unit_at(end);
                extra += len.saturating_sub(u1 - u0);
            }
        }

        let mut out: Vec<u16> = Vec::with_capacity(units.len() + extra);
        let mut previous_end = 0u32;
        let mut previous_unit = 0usize;

        for &(flags, start, end, text_index) in &self.ranges {
            let range_start = start.max(previous_end);
            let range_unit = unit_at(range_start);
            out.extend_from_slice(&units[previous_unit as usize..range_unit]);

            let mut range_unit = range_unit;
            match flags {
                REPLACE_WITH_TEXT => {
                    for unit in self.texts[text_index as usize].encode_utf16() {
                        out.push(unit);
                    }
                }
                REPLACE_WITH_CLOSE_PAREN => {
                    out.push(0x29);
                    range_unit += 1;
                }
                REPLACE_WITH_SEMI => {
                    out.push(0x3B);
                    range_unit += 1;
                }
                REPLACE_WITH_OPEN_PAREN => {
                    out.push(0x28);
                    range_unit += 1;
                }
                _ => {}
            }

            previous_end = end;
            if flags != REPLACE_WITH_TEXT {
                let end_unit = unit_at(previous_end);
                for &unit in &units[range_unit as usize..end_unit as usize] {
                    out.push(match unit {
                        0x0A | 0x0D => unit,
                        _ => 0x20,
                    });
                }
            }
            previous_unit = unit_at(previous_end);
        }

        out.extend_from_slice(&units[previous_unit as usize..]);
        out
    }
}
