function isNullishOrLogical(operator: string): boolean {
  return operator === '??' || operator === '||' || operator === '&&'
}

/** JavaScript requires explicit parentheses when mixing `??` with `||`/`&&`. */
export function hasUnsafeNullishLogicalMix(left: string, right: string): boolean {
  if (left === right) {
    return false
  }
  if (left === '??') {
    return isNullishOrLogical(right)
  }
  if (right === '??') {
    return isNullishOrLogical(left)
  }
  return false
}
