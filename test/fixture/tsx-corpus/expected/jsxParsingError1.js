// @target: es2015
//@jsx: preserve

//@filename: file.tsx
                       
                      
                              
                   
  
 

// This should be a parse error
const class1 = "foo";
const class2 = "bar";
const elem = <div className={class1, class2}/>;
