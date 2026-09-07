/* eslint-disable no-console */

import { transpile, transpileSync } from '@teages/oxc-blank-space'

console.log(transpileSync('const a: number = 1'))
transpile('enum Color { Red, Green = 5 }').then(output => console.log(output))
