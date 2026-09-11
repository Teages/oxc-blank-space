                 
               
                
                                 
 

                                          

function List({ title, count }       )         {
  const items         = []
  const render =     (value   )    => value
  const name = (count ?? 0);         
  const label = render('item');                
  return (
    <ul
      data-count={count }
      data-name={name}
      onClick={(event         )       => onSelect?.(String(event))}
      aria-label={title}
    >
      {items.map(item => (
        <li key={item.id}>{render(item.label ?? item.id)}</li>
      ))}
      <>{`${label}: ${count ?? 0}`}</>
    </ul>
  )
}

export default List
