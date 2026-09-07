use oxc_syntax::operator::LogicalOperator;

/// JavaScript requires explicit parentheses when mixing `??` with `||`/`&&`.
pub fn has_unsafe_nullish_logical_mix(left: LogicalOperator, right: LogicalOperator) -> bool {
    use LogicalOperator::{And, Coalesce, Or};
    if left == right {
        return false;
    }
    if left == Coalesce {
        return matches!(right, Or | And);
    }
    if right == Coalesce {
        return matches!(left, Or | And);
    }
    false
}
