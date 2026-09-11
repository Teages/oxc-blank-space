// @target: es2015
// @filename: file.tsx
// @jsx: preserve
// @module: amd
// @skipLibCheck: true
// @lib: es5
/// <reference path="/.lib/react.d.ts" />

import React = require('react')

;                                                                                     

// OK
function Baz     (key1   , value   ) {
    let a0 = <ComponentWithTwoAttributes key1={key1} value={value} />
    let a1 = <ComponentWithTwoAttributes {...{key1, value: value}} key="Component" />
}

;                                                                

// OK
function createLink(func                   ) {
    let o = <Link func={func} />
}

function createLink1(func                      ) {
    let o = <Link func={func} />
}

;                            
                     
                                            
 

;                                                                             

// OK
let i = <InferParamComponent values={[1, 2, 3, 4]} selectHandler={(val) => { }} />;