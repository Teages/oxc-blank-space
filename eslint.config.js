// @ts-check
import antfu from '@antfu/eslint-config'

export const shared = antfu({
  rules: {
    curly: ['error', 'all'],
  },
})

export default shared.append({
  ignores: ['playground', 'test/fixture'],
})
