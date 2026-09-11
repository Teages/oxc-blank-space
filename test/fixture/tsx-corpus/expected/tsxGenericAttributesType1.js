// @target: es2015
// @module: commonjs
// @filename: file.tsx
// @jsx: preserve
// @skipLibCheck: true
/// <reference path="/.lib/react.d.ts" />

import React = require('react');

const decorator = function    (Component                             )                              {
    return (props) => <Component {...props}></Component>
};

const decorator2 = function                          (Component                             )                              {
    return (props) => <Component {...props} x={2} ></Component>
};

const decorator3 = function                                                    (Component                             )                              {
    return (props) => <Component x={2} {...props} ></Component>
};