// @target: es2015
// @module: commonjs
// @filename: file.tsx
// @jsx: preserve
// @skipLibCheck: true
/// <reference path="/.lib/react.d.ts" />

import React = require('react');

class B1                          extends React.Component        {
    render() {
        return <div>hi</div>; 
    }
}
class B    extends React.Component        {
    render() {
        return <B1 {...this.props} x="hi" />;
    }
}