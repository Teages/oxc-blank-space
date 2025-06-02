/* eslint-disable no-console */
import { transpile } from '../src/index'

console.log(transpile(`


// ^^^^^^^^^^^^^^^ empty namespace












// ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ type-only namespace









// ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ nested namespaces

// declaring the existence of a runtime namespace:
;


// ^^^^^^^^^^^^^^^^^^^^^^^^^^^^





// ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ // _value_ import namespace

Declared.foo(); // May throw at runtime if declaration was false

export const x                   = 1;
//            ^^^^^^^^^^^^^^^^^^
`))
