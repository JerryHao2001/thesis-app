/**
 * Shared graph utilities used by ResolvedStage and KnowledgeBaseStage.
 */

/**
 * Combine two graphs into one, prefixing edge IDs to avoid collisions.
 * prefix1/prefix2 default to 'd1'/'d2' for the first resolve round;
 * pass 'kb'/'new' for subsequent rounds.
 */
export function mergeGraphs(graph1, graph2, prefix1 = 'd1', prefix2 = 'd2') {
  if (!graph1 && !graph2) return { nodes: [], edges: [] }
  return {
    nodes: [
      ...(graph1?.nodes ?? []),
      ...(graph2?.nodes ?? []),
    ],
    edges: [
      ...(graph1?.edges ?? []).map(e => ({ ...e, id: `${prefix1}_${e.id}` })),
      ...(graph2?.edges ?? []).map(e => ({ ...e, id: `${prefix2}_${e.id}` })),
    ],
  }
}

/**
 * Collapse merged cross-doc pairs into single nodes.
 *
 * mergedLinks: array of link objects with mention_1_id, mention_2_id,
 *              mention_1_text, mention_2_text.
 *
 * - Builds surviveMap: doc2_node_id → doc1_node_id
 * - Removes doc2 nodes that are merged away
 * - Marks surviving doc1 nodes with merged:true and combined label
 * - Redirects edges; drops self-loops
 */
export function applyMerges(baseGraph, mergedLinks) {
  if (!mergedLinks || !mergedLinks.length) return baseGraph

  const surviveMap = new Map()  // doc2_id → doc1_id
  const labelMap   = new Map()  // doc1_id → doc2 label

  for (const link of mergedLinks) {
    surviveMap.set(link.mention_2_id, link.mention_1_id)
    labelMap.set(link.mention_1_id, link.mention_2_text)
  }

  const removedIds = new Set(surviveMap.keys())

  function resolve(id) {
    let cur = id
    while (surviveMap.has(cur)) cur = surviveMap.get(cur)
    return cur
  }

  const nodes = baseGraph.nodes
    .filter(n => !removedIds.has(n.id))
    .map(n => {
      if (!labelMap.has(n.id)) return n
      const doc2Label = labelMap.get(n.id)
      const combinedLabel = _normalize(n.label) === _normalize(doc2Label)
        ? n.label
        : `${n.label} / ${doc2Label}`
      return { ...n, label: combinedLabel, merged: true }
    })

  const seenEdges = new Set()
  const edges = []
  for (const e of baseGraph.edges) {
    const src = resolve(e.source)
    const tgt = resolve(e.target)
    if (src === tgt) continue
    const key = `${e.id}|${src}|${tgt}`
    if (seenEdges.has(key)) continue
    seenEdges.add(key)
    edges.push({ ...e, source: src, target: tgt })
  }

  return { nodes, edges }
}

function _normalize(s) {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ')
}
