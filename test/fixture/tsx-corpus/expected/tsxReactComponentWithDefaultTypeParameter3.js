// @target: es2015
// @module: commonjs
// @filename: file.tsx
// @jsx: preserve
// @skipLibCheck: true
/// <reference path="/.lib/react.d.ts" />

import React = require('react');

                
              
             
 

                                                                     
                    
 

// Error
let x1 = <MyComp />

// OK
let x = <MyComp a={10} b="hi" />

// Error
let x2 = <MyComp a="hi"/>