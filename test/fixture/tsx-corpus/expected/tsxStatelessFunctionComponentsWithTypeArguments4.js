// @target: es2015
// @filename: file.tsx
// @jsx: preserve
// @module: commonjs
// @skipLibCheck: true
/// <reference path="/.lib/react.d.ts" />

import React = require('react')

;                                                    
;                                                                                                   
;                                                                         

// Error
function Baz                                                         (arg1   , arg2   ) {
    let a0 = <OverloadComponent a={arg1.b}/>
    let a2 = <OverloadComponent {...arg1} ignore-prop />  // missing a
}