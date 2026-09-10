//! JS `Number` semantics for enum constant folding: `String(value)` (the
//! `Number::toString` algorithm) and the `ToInt32`/`ToUint32` conversions
//! the bitwise operators go through. Pure functions — no AST dependency.

/// `String(value)` — the JS `Number::toString` algorithm.
///
/// Shortest round-trip digits come from `dtoa` (the double-conversion
/// algorithm V8 also uses). Shortest digits are not always unique: when the
/// value lies exactly halfway between two same-length decimals, ECMAScript
/// mandates the candidate with an even digit string ("round half to even")
/// while the generation algorithms round half away from zero — the source of
/// the `1381472817847324.2` vs `.3` divergence. Exact ties are detected with
/// integer arithmetic on the value's binary decomposition (|v| = odd m x 2^e:
/// a tie at decimal shift d = n - k exists iff d == e + 1, m is odd, and
/// 5^(-d) divides m when d < 0), and the digits are bumped to their even
/// neighbor. The digits are then laid out per the ECMAScript specification
/// (decimal form for -6 < n <= 21, exponential otherwise).
pub(super) fn js_number_to_string(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value < 0.0 { "-Infinity" } else { "Infinity" }.to_string();
    }
    if value == 0.0 {
        return "0".to_string();
    }

    let negative = value.is_sign_negative();
    let magnitude = value.abs();

    // shortest round-trip digits of |value|, as d = n - k in |value| = s x 10^d
    let scientific = format!("{magnitude:e}");
    let (mantissa, exponent) = scientific.split_once('e').expect("LowerExp form");
    let exponent: i32 = exponent.parse().expect("decimal exponent");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let digits = digits.trim_end_matches('0');
    let mut digits_int: u64 = digits.parse().expect("shortest digits fit u64");
    let d = exponent - (digits.len() as i32 - 1);

    // round half to even (ECMAScript) instead of half away from zero
    if digits_int % 2 == 1 && is_exact_tie(magnitude, d) {
        digits_int = tie_partner(magnitude, digits_int, d);
    }

    let negative_prefix = if negative { "-" } else { "" };
    let layout = layout_digits(digits_int, d);
    format!("{negative_prefix}{layout}")
}

/// Lay the decimal digits out per ECMAScript: `|value| = digits x 10^(-d)`
/// with the digit count folded into n = k + d.
fn layout_digits(digits_int: u64, d: i32) -> String {
    let digits = digits_int.to_string();
    let k = digits.len() as i32;
    let n = k + d;

    if -6 < n && n <= 21 {
        if n >= k {
            let mut out = digits;
            for _ in 0..(n - k) {
                out.push('0');
            }
            return out;
        }
        if n > 0 {
            let mut out = String::new();
            out.push_str(&digits[..n as usize]);
            out.push('.');
            out.push_str(&digits[n as usize..]);
            return out;
        }
        let mut out = String::from("0.");
        for _ in 0..(-n) {
            out.push('0');
        }
        out.push_str(&digits);
        return out;
    }

    // exponential form: d[.ddd]e(+|-)x
    let mut out = String::new();
    out.push_str(&digits[..1]);
    if k > 1 {
        out.push('.');
        out.push_str(&digits[1..]);
    }
    out.push('e');
    let exponent = n - 1;
    out.push(if exponent < 0 { '-' } else { '+' });
    out.push_str(&exponent.abs().to_string());
    out
}

/// The even tie partner of the odd shortest digits `digits` (which the
/// generation algorithm rounded half away from zero). Within a tie,
/// |v| x 10^(-d) = digits +- 0.5, i.e. |v| x 2 x 10^(-d) = m x 5^(-d) (the
/// tie condition collapses the power of two to zero); comparing that odd
/// integer with 2 x digits picks the direction.
fn tie_partner(v: f64, digits: u64, d: i32) -> u64 {
    let (m, _) = odd_decomposition(v);
    let scaled_times_two: u128 = if d <= 0 {
        let mut pow5: u128 = 1;
        let cap: u128 = 2 * digits as u128 + 1;
        for _ in 0..(-d) {
            pow5 *= 5;
            if pow5 > cap {
                break;
            }
        }
        (m as u128) * pow5
    } else {
        (m / 5u64.pow(d as u32)) as u128
    };
    if scaled_times_two > 2 * digits as u128 {
        digits + 1
    } else {
        digits - 1
    }
}

/// Exact binary decomposition of a finite positive double: |v| = m x 2^e with
/// m odd. Returns (m, e).
fn odd_decomposition(v: f64) -> (u64, i32) {
    let bits = v.to_bits();
    let biased = ((bits >> 52) & 0x7ff) as i32;
    let fraction = bits & 0xf_ffff_ffff_ffff;
    let (mut m, mut e) = if biased == 0 {
        (fraction, -1074)
    } else {
        (fraction | (1 << 52), biased - 1075)
    };
    while m % 2 == 0 {
        m /= 2;
        e += 1;
    }
    (m, e)
}

/// Whether |v| = digits x 10^d lies exactly halfway between
/// (digits - 1) x 10^d and (digits + 1) x 10^d, i.e. whether
/// |v| x 2 x 10^d is an odd integer (then the two neighbors are equally
/// close). Requires `digits` to be the shortest round-trip digits of `|v|`.
fn is_exact_tie(v: f64, d: i32) -> bool {
    let (m, e) = odd_decomposition(v);
    // |v| x 2 x 10^(-d) = m x 2^(e + 1 - d) x 5^(-d) — an odd integer
    // requires the power of two to vanish, an odd mantissa, and no 5s in the
    // denominator.
    if e + 1 - d != 0 || m % 2 == 0 {
        return false;
    }
    if d > 0 {
        // 5^d must divide m (m <= 2^53 bounds the loop to ~23 steps)
        let mut power = 5u64;
        let mut count = 1u32;
        while count < d as u32 {
            match power.checked_mul(5) {
                Some(p) if p <= m => power = p,
                _ => return false,
            }
            count += 1;
        }
        return m % power == 0;
    }
    true
}

pub(super) fn to_int32(value: f64) -> i32 {
    if !value.is_finite() {
        return 0;
    }
    let truncated = value.trunc();
    let modulo = truncated.rem_euclid(4_294_967_296.0);
    if modulo >= 2_147_483_648.0 {
        (modulo - 4_294_967_296.0) as i32
    } else {
        modulo as i32
    }
}

pub(super) fn to_uint32(value: f64) -> u32 {
    if !value.is_finite() {
        return 0;
    }
    value.trunc().rem_euclid(4_294_967_296.0) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_number_formatting() {
        assert_eq!(js_number_to_string(0.0), "0");
        assert_eq!(js_number_to_string(5.0), "5");
        assert_eq!(js_number_to_string(-1.0), "-1");
        assert_eq!(js_number_to_string(1.5), "1.5");
        // shortest round-trip digits, not the exact binary value
        assert_eq!(
            js_number_to_string(1000000000000000128.0),
            "1000000000000000100"
        );
        assert_eq!(js_number_to_string(1e20), "100000000000000000000");
        assert_eq!(js_number_to_string(1e21), "1e+21");
        assert_eq!(js_number_to_string(1e-6), "0.000001");
        assert_eq!(js_number_to_string(1e-7), "1e-7");
        // exact tie: the even candidate wins (1381472817847324.25 sits
        // exactly halfway between ...324.2 and ...324.3)
        assert_eq!(
            js_number_to_string(1381472817847324.2),
            "1381472817847324.2"
        );
    }
}
