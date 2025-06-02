import type { Node } from 'oxc-parser'

export type NodeType = Node['type']
export type CallbackOf<T extends NodeType> = (node: Node & { type: T }, parent: Node | null) => (Node | null | undefined | void)[] | Node | null | undefined | void
export type WalkerCallbacks = {
  [K in NodeType]?: CallbackOf<K> | null
}

const warned = new Set<string>()

export function walk(node: Node, callbacks: WalkerCallbacks, unknownNodeHandler: CallbackOf<NodeType>) {
  _walk(null, node, callbacks, unknownNodeHandler)
}

function _walk(parent: Node | null, node: Node, callbacks: WalkerCallbacks, unknownNodeHandler: CallbackOf<NodeType>) {
  if (!node.type) {
    return
  }

  const callback = callbacks[node.type] as CallbackOf<NodeType>

  if (!callback) {
    if (callback === undefined && !warned.has(node.type)) {
      const children = unknownNodeHandler(node, parent)
      if (Array.isArray(children)) {
        for (const child of children) {
          if (child) {
            _walk(node, child, callbacks, unknownNodeHandler)
          }
        }
      }
      else if (children) {
        _walk(node, children, callbacks, unknownNodeHandler)
      }
    }
    return
  }

  const children = callback(node, parent)
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child) {
        _walk(node, child, callbacks, unknownNodeHandler)
      }
    }
  }
  else if (children) {
    _walk(node, children, callbacks, unknownNodeHandler)
  }
}
