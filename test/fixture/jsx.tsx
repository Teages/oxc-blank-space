interface Props {
  title: string
  count?: number
  onSelect?: (id: string) => void
}

type Item = { id: string; label?: string }

function List({ title, count }: Props): string {
  const items: Item[] = []
  const render = <T,>(value: T): T => value
  const name = (count ?? 0) as number
  const label = render('item') satisfies string
  return (
    <ul
      data-count={count!}
      data-name={name}
      onClick={(event: unknown): void => onSelect?.(String(event))}
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
