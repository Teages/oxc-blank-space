// @target: es2015
//@filename: file.tsx
//@jsx: react
                       
                      
                              
                   
  
 
                       

var p     ;
var openClosed1 = <div>

   {blah}

</div>;

// Should emit React.__spread({}, p, {x: 0})
var spread1 = <div {...p} x={0} />;