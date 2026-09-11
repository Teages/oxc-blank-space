// @target: es2015
// @filename: file.tsx
// @jsx: preserve
// @module: amd
// @skipLibCheck: true
// @lib: es5
/// <reference path="/.lib/react.d.ts" />

import React = require('react')

;                                                                                        
;                                                                 

// Error
function Bar                          (arg   ) {
    let a1 = <ComponentSpecific1 {...arg} ignore-prop={10} />;
 }

// Error
function Baz   (arg   ) {
    let a0 = <ComponentSpecific1 {...arg} />
}

;                                                                

// Error
function createLink(func                              ) {
    let o = <Link func={func} />
}

;                            
                     
                                            
 

;                                                                             

// Error
let i = <InferParamComponent values={[1, 2, 3, 4]} selectHandler={(val        ) => { }} />;
