// @target: es2015
// @module: commonjs
// @filename: file.tsx
// @jsx: preserve
// @skipLibCheck: true
/// <reference path="/.lib/react.d.ts" />

import React = require('react');

export function makeP   (Ctor                         ) {
	return class extends React.PureComponent          {
		       render()              {
			return (
				<Ctor {...this.props } />
			);
		}
	};
}

