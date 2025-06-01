import type { Node } from 'oxc-parser'

export type NodeType = Node['type']
export type CallbackOf<T extends NodeType> = (node: Node & { type: T }, parent: Node | null) => (Node | null | undefined)[] | Node | undefined | void
export type WalkerCallbacks = {
  [K in NodeType]?: CallbackOf<K> | null
}

const warned = new Set<string>()

export function walk(node: Node, callbacks: WalkerCallbacks) {
  _walk(null, node, callbacks)
}

function _walk(parent: Node | null, node: Node, callbacks: WalkerCallbacks) {
  if (!node.type) {
    return
  }

  const callback = callbacks[node.type] as ((node: Node, parent: Node | null) => (Node | null | undefined)[] | Node | undefined) | null | undefined

  if (!callback) {
    if (callback === undefined && !warned.has(node.type)) {
      // FIXME: I am lazy so I just writing handler for node type listed in the test cases
      console.warn(`No callback found for node type: ${node.type}`)
      warned.add(node.type)
    }
    return
  }

  const children = callback(node, parent)
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child) {
        _walk(node, child, callbacks)
      }
    }
  }
  else if (children) {
    _walk(node, children, callbacks)
  }
}
