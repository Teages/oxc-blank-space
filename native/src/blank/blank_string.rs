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
    /// Override texts as UTF-16 units — the only lossless form shared by the
    /// String path and the UTF-16 path (raw lone surrogates can appear on the
    /// UTF-16 path and must survive into the output).
    texts: Vec<Vec<u16>>,
}

impl BlankString {
    /// Replace [start, end) with `text`; `end` may equal `start` to insert.
    pub fn override_range(&mut self, start: u32, end: u32, text: impl AsRef<str>) {
        self.override_range_units(
            start,
            end,
            "",
            &text.as_ref().encode_utf16().collect::<Vec<u16>>(),
        );
    }

    /// [`override_range`](Self::override_range) with the replacement given as
    /// UTF-16 units — required when the text contains raw lone surrogates.
    pub fn override_range_units(&mut self, start: u32, end: u32, prefix: &str, units: &[u16]) {
        let index = self.texts.len() as u32;
        let mut text: Vec<u16> = prefix.encode_utf16().collect();
        text.extend_from_slice(units);
        self.texts.push(text);
        self.ranges.push((REPLACE_WITH_TEXT, start, end, index));
    }

    /// [`override_range`](Self::override_range) spliced in at its source
    /// position among the already-pushed ranges. The enum walk erases an
    /// initializer first and collects its reference rewrites second; the two
    /// interleave by position, and out-of-order ranges would corrupt the
    /// output in [`build`](Self::build).
    pub fn override_range_sorted(&mut self, start: u32, end: u32, text: impl AsRef<str>) {
        let index = self.texts.len() as u32;
        self.texts.push(text.as_ref().encode_utf16().collect());
        let at = self
            .ranges
            .partition_point(|&(_, range_start, _, _)| range_start <= start);
        self.ranges
            .insert(at, (REPLACE_WITH_TEXT, start, end, index));
    }

    /// Whether [start, end) overlaps any already-pushed range. The enum walk
    /// runs reference qualification after the erasure pass: an identifier
    /// inside an erased region (a type alias, an annotation) must not be
    /// rewritten — splicing text into erased content corrupts the output.
    pub fn overlaps_pushed_range(&self, start: u32, end: u32) -> bool {
        let pushed = self
            .ranges
            .partition_point(|&(_, range_start, _, _)| range_start < end);
        pushed > 0 && self.ranges[pushed - 1].2 > start
    }

    pub fn blank_but_start_with_open_paren(&mut self, start: u32, end: u32) {
        self.ranges
            .push((REPLACE_WITH_OPEN_PAREN, start, end, u32::MAX));
    }

    pub fn blank_but_end_with_close_paren(&mut self, start: u32, end: u32) {
        self.ranges
            .push((REPLACE_WITH_BLANK, start, end - 1, u32::MAX));
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
                REPLACE_WITH_TEXT => out.extend_from_slice(
                    String::from_utf16(&self.texts[text_index as usize])
                        .expect("String-path texts are valid UTF-16")
                        .as_bytes(),
                ),
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
        // the buffer only ever holds input bytes, spaces, and caller text
        String::from_utf8(out).expect("output buffer is valid UTF-8")
    }
}

/// Preserve every newline inside [start, end) and replace everything else with
/// one space per UTF-16 code unit (a non-BMP char becomes 2 spaces).
///
/// Ranges pushed out of source order (a blank nested inside an already-blanked
/// region) write nothing.
fn write_space(out: &mut Vec<u8>, input: &str, start: u32, end: u32) {
    if start >= end {
        return;
    }
    let bytes = &input.as_bytes()[start as usize..end as usize];
    if bytes.is_ascii() {
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

impl BlankString {
    /// UTF-16 variant of [`build`](Self::build) for the lossless UTF-16 path:
    /// the input is the original code units, `byte_to_unit` maps every parse
    /// copy byte offset to its unit index (strictly increasing), and the
    /// result is the output in code units. Blanked ranges preserve newline
    /// units and replace every other unit (including lone surrogates) with a
    /// single space.
    pub fn build_units(&self, units: &[u16], byte_to_unit: &[u32]) -> Vec<u16> {
        if self.ranges.is_empty() {
            return units.to_vec();
        }
        let unit_at = |pos: u32| byte_to_unit.partition_point(|&b| b < pos);

        let mut extra = 0usize;
        for &(flags, start, end, text_index) in &self.ranges {
            if flags == REPLACE_WITH_TEXT {
                let len = self.texts[text_index as usize].len();
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
            out.extend_from_slice(&units[previous_unit..range_unit]);

            let mut range_unit = range_unit;
            match flags {
                REPLACE_WITH_TEXT => out.extend_from_slice(&self.texts[text_index as usize]),
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
                for &unit in &units[range_unit..end_unit] {
                    out.push(match unit {
                        0x0A | 0x0D => unit,
                        _ => 0x20,
                    });
                }
            }
            previous_unit = unit_at(previous_end);
        }

        out.extend_from_slice(&units[previous_unit..]);
        out
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
    fn blank_preserves_crlf_and_replaces_ls_ps_with_spaces() {
        // Pinned behavior: blanked regions keep CR/LF as line breaks; U+2028
        // and U+2029 become single spaces like any other character, matching
        // the reference implementation. One space per UTF-16 unit keeps the
        // length stable either way.
        let input = "a\nb\r\nc\u{2028}d\u{2029}e";
        let mut bs = BlankString::default();
        bs.blank(0, input.len() as u32);
        assert_eq!(bs.build(input), " \n \r\n     ");
    }

    #[test]
    fn build_units_preserves_crlf_and_replaces_ls_ps_with_spaces() {
        // The UTF-16 path pins the same behavior. byte_to_unit mirrors
        // transpile_units' construction for "a\u{2028}b\u{2029}c": the
        // parse-copy byte offset after each unit, plus the total sentinel.
        let units: Vec<u16> = "a\u{2028}b\u{2029}c".encode_utf16().collect();
        let byte_to_unit = [0u32, 1, 4, 5, 8, 9];
        let mut bs = BlankString::default();
        bs.blank(0, 9);
        assert_eq!(bs.build_units(&units, &byte_to_unit), vec![0x20; 5]);
    }

    #[test]
    fn no_ranges_returns_input() {
        let bs = BlankString::default();
        assert_eq!(bs.build("abc"), "abc");
    }
}
