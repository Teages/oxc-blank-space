// @target: es2015
// @module: commonjs
// @filename: foo.tsx
// @jsx: preserve
// @skipLibCheck: true
/// <reference path="/.lib/react.d.ts" />

import React = require('react');

                                    
                                           

function Foo   () {
    return null;
}

<>
    {/* JsxSelfClosingElement */}
    <Foo          />
    <Foo         />
    <Foo          />
    <Foo         />
    <Foo       />
    <Foo      />
    <Foo        />
    <Foo            />
    <Foo            />
    <Foo                 />

    {/* JsxOpeningElement */}
    <Foo         ></Foo>
    <Foo        ></Foo>
    <Foo         ></Foo>
    <Foo        ></Foo>
    <Foo      ></Foo>
    <Foo     ></Foo>
    <Foo       ></Foo>
    <Foo           ></Foo>
    <Foo           ></Foo>
    <Foo                ></Foo>
</>
