// @target: es2015
// @module: commonjs
// @filename: file.tsx
// @jsx: preserve
// @skipLibCheck: true
/// <reference path="/.lib/react.d.ts" />

import React = require('react');

                
              
             
 

                                                        
                    
 

let x = <MyComp       a={10} b="hi" />; // OK

x = <MyComp       a={10} b="hi"></MyComp>; // OK

x = <MyComp       a={10} b={20} />; // error

x = <MyComp       a={10} b={20}></MyComp>; // error

x = <MyComp             a={10} b="hi" />; // error

x = <MyComp             a={10} b="hi"></MyComp>; // error

x = <MyComp   a={10} b="hi" />; // error

x = <MyComp   a={10} b="hi"></MyComp>; // error

x= <MyComp     /> // OK

x= <MyComp    ></MyComp> // OK

;                                                                                            
                          
 
x = <MyComp2                         a="a" b="b" />; // OK

x = <MyComp2                         a="a" b="b"></MyComp2>; // OK

x = <MyComp2       a={10} b="hi" />; // error

x = <MyComp2       a={10} b="hi"></MyComp2>; // error

x = <MyComp2                           a="hi" b="hi" />; // OK

x = <MyComp2                           a="hi" b="hi"></MyComp2>; // OK

x = <MyComp2                                 a="hi" b="hi" />; // error

x = <MyComp2                                 a="hi" b="hi"></MyComp2>; // error

x = <MyComp2                           a="hi" b="hi" />; // error

x = <MyComp2                           a="hi" b="hi"></MyComp2>; // error
