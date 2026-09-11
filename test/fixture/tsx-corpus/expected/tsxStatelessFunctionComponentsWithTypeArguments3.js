// @target: es2015
// @filename: file.tsx
// @jsx: preserve
// @module: amd
// @skipLibCheck: true
/// <reference path="/.lib/react.d.ts" />

import React = require('react')

;                                                    
;                                                                                                    
;                                                                         

// OK
function Baz                                                         (arg1   , arg2   ) {
    let a0 = <OverloadComponent {...arg1} a="hello" ignore-prop />;
    let a1 = <OverloadComponent {...arg2} ignore-pro="hello world" />;
    let a2 = <OverloadComponent {...arg2} />;
    let a3 = <OverloadComponent {...arg1} ignore-prop />;
    let a4 = <OverloadComponent />;
    let a5 = <OverloadComponent {...arg2} ignore-prop="hello" {...arg1} />;
    let a6 = <OverloadComponent {...arg2} ignore-prop {...arg1} />;
}

;                                                                
;                                                                              
function createLink(func                   ) {
    let o = <Link func={func} />
    let o1 = <Link func={(a       , b       )=>{}} />;
}