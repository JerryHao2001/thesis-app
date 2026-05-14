import { useEffect, useRef } from 'react'
import { Network } from 'vis-network'
import { DataSet } from 'vis-data'

// ── Visual constants (easy to update later for shapes/colors) ──────────────────

const ENTITY_COLORS = {
  task:                   { background: '#FF6B6B', border: '#c0392b' },
  method:                 { background: '#4ECDC4', border: '#16a085' },
  metric:                 { background: '#FFD93D', border: '#f39c12' },
  material:               { background: '#74b9ff', border: '#2980b9' },
  'other scientific term':{ background: '#a29bfe', border: '#6c5ce7' },
  generic:                { background: '#b2bec3', border: '#7f8c8d' },
}

// Shape encodes document origin (redundant with border color for extra clarity)
export const DOC_SHAPES = {
  0: 'ellipse',  // Doc 1 → oval
  1: 'box',      // Doc 2 → rectangle
}

// Blue border = Doc 1 (doc_id 0), Orange border = Doc 2 (doc_id 1)
export const DOC_BORDER_COLORS = {
  0: '#3b82f6',
  1: '#f97316',
}

// Purple border for nodes merged from both documents
export const MERGED_NODE_BORDER = '#7c3aed'

const RELATION_COLORS = {
  'used for':    '#555',
  'feature of':  '#777',
  'hyponym of':  '#888',
  'part of':     '#666',
  'evaluate for':'#444',
  compare:       '#e74c3c',
  conjunction:   '#9b59b6',
}

const VIS_OPTIONS = {
  physics: {
    enabled: true,
    barnesHut: {
      gravitationalConstant: -6000,
      centralGravity: 0.25,
      springLength: 120,
      springConstant: 0.04,
      damping: 0.15,
    },
    stabilization: { iterations: 150 },
  },
  layout: { improvedLayout: true },
  interaction: { hover: true, tooltipDelay: 200 },
  edges: {
    smooth: { type: 'curvedCW', roundness: 0.15 },
    font: { size: 10, align: 'middle', color: '#444' },
  },
  nodes: {
    font: { size: 12, color: '#1a1d23' },
    borderWidth: 1.5,
  },
}

function buildVisData(graph, crossDocLinks = [], showDocBorders = false) {
  const nodes = new DataSet(
    (graph?.nodes ?? []).map(n => {
      const typeColor = ENTITY_COLORS[n.entity_type] ?? ENTITY_COLORS.generic
      const isMerged = !!n.merged
      // is_new_article: set on new-article nodes regardless of their numeric doc_id,
      // so styling stays correct even when doc_id > 1 (round 3+).
      const isNew = !!n.is_new_article
      const borderColor = isMerged
        ? MERGED_NODE_BORDER
        : showDocBorders
          ? (isNew ? DOC_BORDER_COLORS[1] : (DOC_BORDER_COLORS[n.doc_id] ?? typeColor.border))
          : typeColor.border
      const borderWidth = isMerged ? 4 : showDocBorders ? 3 : 1.5
      const shape = isMerged ? 'ellipse' : isNew ? DOC_SHAPES[1] : (DOC_SHAPES[n.doc_id] ?? 'ellipse')
      const docLabel = isMerged ? 'Merged (KB + New)' : isNew ? 'New article' : `Doc ${n.doc_id + 1}`
      return {
        id: n.id,
        label: n.label,
        color: { background: typeColor.background, border: borderColor },
        borderWidth,
        shape,
        title: `<b>${n.label}</b><br/>Type: ${n.entity_type}<br/>${docLabel}${n.frequency > 1 ? `<br/>freq: ${n.frequency}` : ''}`,
      }
    })
  )

  const intraEdges = (graph?.edges ?? []).map(e => ({
    id: e.id,
    from: e.source,
    to: e.target,
    label: e.relation_type,
    color: { color: RELATION_COLORS[e.relation_type] ?? '#999', inherit: false },
    arrows: e.bidirectional
      ? { to: { enabled: true }, from: { enabled: true } }
      : { to: { enabled: true } },
    dashes: false,
  }))

  const corefEdges = crossDocLinks.map((link, i) => ({
    id: `coref_${i}`,
    from: link.mention_1_id,
    to: link.mention_2_id,
    label: `coref ${Math.round(link.score * 100)}%`,
    color: { color: '#FF1493', inherit: false },
    arrows: { to: { enabled: true }, from: { enabled: true } },
    dashes: true,
    width: 2,
    font: { color: '#FF1493', size: 10 },
    title: `Coreference: "${link.mention_1_text}" ↔ "${link.mention_2_text}"<br/>Score: ${(link.score * 100).toFixed(1)}%`,
  }))

  const edges = new DataSet([...intraEdges, ...corefEdges])
  return { nodes, edges }
}

const EMPTY_LINKS = []

export default function GraphViewer({ graph, crossDocLinks = EMPTY_LINKS, height = 380, showDocBorders = false }) {
  const containerRef = useRef(null)
  const networkRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return
    if (!graph || graph.nodes.length === 0) return

    const { nodes, edges } = buildVisData(graph, crossDocLinks, showDocBorders)

    if (networkRef.current) {
      networkRef.current.destroy()
    }

    networkRef.current = new Network(
      containerRef.current,
      { nodes, edges },
      VIS_OPTIONS,
    )

    return () => {
      networkRef.current?.destroy()
      networkRef.current = null
    }
  }, [graph, crossDocLinks, showDocBorders])

  const isEmpty = !graph || graph.nodes.length === 0

  return (
    <div className="graph-container" style={{ height }}>
      {isEmpty ? (
        <div className="empty" style={{ paddingTop: height / 2 - 20 }}>
          No entities extracted yet.
        </div>
      ) : (
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      )}
    </div>
  )
}

export { ENTITY_COLORS, RELATION_COLORS }
