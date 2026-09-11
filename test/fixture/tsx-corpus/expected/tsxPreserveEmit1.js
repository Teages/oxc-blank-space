//@module: amd
//@jsx: preserve
//@target: ES5, ES2015

//@Filename: react.d.ts
                        
            
            
 

                               
                
                    
 
                               
                      
 

//@Filename: test.tsx
// Should emit 'react-router' in the AMD dependency list
import React = require('react');
import ReactRouter = require('react-router');

import Route = ReactRouter.Route;

var routes1 = <Route />;

namespace M {
	export var X: any;
}
namespace M {
	// Should emit 'M.X' in both opening and closing tags
	var y = <X></X>;
}
