// @target: es2015
//@jsx: preserve

                       
                      
                              
                   
  
 
                       

                    
               
                 
 
                         
                      
 
function Todo(prop                               ) {
    return <div>{prop.key.toString() + prop.todo}</div>;
}
function TodoList({ todos }               ) {
    return <div>
        {...todos.map(todo => <Todo key={todo.id} todo={todo.todo}/>)}
    </div>;
}
let x               ;
    <TodoList {...x}/>
