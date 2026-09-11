// @target: es2015
// @filename: file.tsx
// @jsx: preserve
// @module: amd
// @skipLibCheck: true
/// <reference path="/.lib/react.d.ts" />

import React = require('react')

;                                                
function createComponent                            (arg   ) {
    let a1 = <Component {...arg} />;
    let a2 = <Component {...arg} prop1 />;
}

;                                                                  
;                                                                                          

function Bar                            (arg   ) {
    let a1 = <ComponentSpecific {...arg} ignore-prop="hi" />;  // U is number
    let a2 = <ComponentSpecific1 {...arg} ignore-prop={10} />;  // U is number
    let a3 = <ComponentSpecific {...arg} prop="hello" />;   // U is "hello"
    let a4 = <ComponentSpecific {...arg} prop1="hello" />;   // U is "hello"
}
