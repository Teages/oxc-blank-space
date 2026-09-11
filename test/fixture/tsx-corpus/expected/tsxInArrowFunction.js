// @target: es2015
// @jsx: preserve

                       
                         
                                 
              
                          
         
     
 


// didn't work
<div>{() => <div text="wat" />}</div>;

// didn't work
<div>{x => <div text="wat" />}</div>;

// worked
<div>{() => (<div text="wat" />)}</div>;

// worked (!)
<div>{() => <div text="wat"></div>}</div>;
