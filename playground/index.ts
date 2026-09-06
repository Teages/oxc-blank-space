/* eslint-disable no-console */

import { transpile } from '@teages/oxc-blank-space'

console.log(transpile('const a: number = 1'))
console.log(transpile('enum Color { Red, Green = 5 }'))
