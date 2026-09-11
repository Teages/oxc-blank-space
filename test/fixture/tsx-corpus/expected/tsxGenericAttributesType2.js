// @target: es2015
// @module: commonjs
// @filename: file.tsx
// @jsx: preserve
// @skipLibCheck: true
/// <reference path="/.lib/react.d.ts" />

import React = require('react');

const decorator4 = function                          (Component                             )                              {
    return (props) => <Component {...props} y={"blah"} ></Component>
};