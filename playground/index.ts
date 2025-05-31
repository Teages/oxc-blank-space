/* eslint-disable no-console */
import { transplat } from '../src/index'

console.log(transplat(`


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
