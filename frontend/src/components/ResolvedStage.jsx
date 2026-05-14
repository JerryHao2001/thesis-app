import { useState, useMemo } from 'react'
import GraphViewer, { ENTITY_COLORS, DOC_BORDER_COLORS, DOC_SHAPES, MERGED_NODE_BORDER } from './GraphViewer.jsx'
import { mergeGraphs, applyMerges } from '../graphUtils.js'

// ─── Sub-components ────────────────────────────────────────────────────────────

function InputTexts({ doc1Text, doc2Text }) {
  return (
    <div className="two-col">
      <div>
        <div className="section-label">Document 1</div>
        <textarea
          readOnly
          value={doc1Text ?? ''}
          style={{ height: 90, background: '#f7f8fa', cursor: 'default', resize: 'none' }}
        />
      </div>
      <div>
        <div className="section-label">Document 2</div>
        <textarea
          readOnly
          value={doc2Text ?? ''}
          style={{ height: 90, background: '#f7f8fa', cursor: 'default', resize: 'none' }}
        />
      </div>
    </div>
  )
}

function LinkTable({ links, threshold, onUnlink }) {
  if (!links || links.length === 0) {
    return <div className="empty">No cross-document coreference links found.</div>
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Mention (Doc 1)</th>
          <th>Mention (Doc 2)</th>
          <th>Confidence</th>
          <th>Cluster</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {links.map((link, i) => {
          const pct = link.score * 100
          const isMerged = pct > threshold
          return (
            <tr key={i}>
              <td><strong>{link.mention_1_text}</strong></td>
              <td><strong>{link.mention_2_text}</strong></td>
              <td>
                <div className="score-bar">
                  <div className="score-fill" style={{ width: `${Math.round(pct * 0.8)}px` }} />
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pct.toFixed(1)}%</span>
                </div>
              </td>
              <td style={{ color: 'var(--muted)', fontSize: 12 }}>#{link.cluster_id}</td>
              <td>
                {isMerged
                  ? <span className="badge" style={{ background: '#ede9fe', color: '#6d28d9' }}>merged</span>
                  : <span className="badge" style={{ background: '#f3f4f6', color: '#6b7280' }}>linked</span>}
              </td>
              <td>
                <button
                  className="btn-secondary"
                  style={{ padding: '3px 10px', fontSize: 11 }}
                  onClick={() => onUnlink(i)}
                >
                  Unlink
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Legend() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div className="section-label">Entity Type (fill color)</div>
        <div className="legend">
          {Object.entries(ENTITY_COLORS).map(([type, color]) => (
            <div key={type} className="legend-item">
              <div className="legend-dot" style={{ background: color.background, border: `1px solid ${color.border}` }} />
              <span>{type}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="section-label">Document Origin (shape + border)</div>
        <div className="legend">
          {[0, 1].map(docId => (
            <div key={docId} className="legend-item">
              <div style={{
                width: 18, height: 14, flexShrink: 0,
                border: `3px solid ${DOC_BORDER_COLORS[docId]}`,
                background: 'transparent',
                borderRadius: DOC_SHAPES[docId] === 'ellipse' ? '50%' : '2px',
              }} />
              <span>Document {docId + 1} ({DOC_SHAPES[docId]})</span>
            </div>
          ))}
          <div className="legend-item">
            <div style={{
              width: 18, height: 14, flexShrink: 0,
              border: `4px solid ${MERGED_NODE_BORDER}`,
              background: 'transparent',
              borderRadius: '50%',
            }} />
            <span>Merged node (both docs)</span>
          </div>
          <div className="legend-item">
            <div style={{ width: 28, borderTop: '2.5px dashed #FF1493' }} />
            <span>Coreference link (below threshold)</span>
          </div>
        </div>
      </div>
    </div>
  )
}


// ─── Main component ────────────────────────────────────────────────────────────

export default function ResolvedStage({ doc1, doc2, resolved, onFinalize }) {
  const [activeLinks, setActiveLinks] = useState(() => resolved?.cross_doc_links ?? [])
  const [threshold, setThreshold] = useState(100)
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState('')

  function handleUnlink(idx) {
    setActiveLinks(prev => prev.filter((_, i) => i !== idx))
  }

  const mergedLinks = activeLinks.filter(l => l.score * 100 > threshold)
  const dashedLinks  = activeLinks.filter(l => l.score * 100 <= threshold)

  const baseGraph = useMemo(
    () => mergeGraphs(doc1?.graph, doc2?.graph),
    [doc1?.graph, doc2?.graph]
  )

  const displayGraph = useMemo(
    () => applyMerges(baseGraph, mergedLinks),
    [baseGraph, mergedLinks]
  )

  const mergeCount = mergedLinks.length
  const totalCount = activeLinks.length

  async function handleFinalize() {
    setFinalizeError('')
    setFinalizing(true)
    try {
      await onFinalize(activeLinks, threshold, displayGraph)
    } catch (e) {
      setFinalizeError(`Finalize failed: ${e.message}`)
    } finally {
      setFinalizing(false)
    }
  }

  return (
    <div className="resolved-section">
      <hr className="divider" />
      <h2>🔗 Cross-Document Coreference Results</h2>

      {/* ── Merged graph ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          Merged Knowledge Graph
          <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}>
            {totalCount} link{totalCount !== 1 ? 's' : ''} · {mergeCount} merged
          </span>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>All merged</span>
            <input
              type="range" min={0} max={100} value={threshold}
              onChange={e => setThreshold(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>None merged</span>
            <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', minWidth: 100, textAlign: 'right' }}>
              Threshold: {threshold}%
            </span>
          </div>
          <GraphViewer graph={displayGraph} crossDocLinks={dashedLinks} height={480} showDocBorders />
          <div style={{ marginTop: 14 }}>
            <Legend />
          </div>
        </div>
      </div>

      {/* ── Source documents ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">Source Documents</div>
        <div className="card-body">
          <InputTexts doc1Text={doc1?.text} doc2Text={doc2?.text} />
        </div>
      </div>

      {/* ── Coreference links table ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">Coreference Links</div>
        <div className="card-body">
          <LinkTable links={activeLinks} threshold={threshold} onUnlink={handleUnlink} />
        </div>
      </div>

      {/* ── Finalize ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
        {finalizeError && <span style={{ color: 'var(--danger)', fontSize: 13 }}>{finalizeError}</span>}
        <button
          className="btn-primary"
          onClick={handleFinalize}
          disabled={finalizing}
          style={{ fontSize: 14, padding: '10px 24px' }}
        >
          {finalizing
            ? <><span className="spinner" />Building Knowledge Base…</>
            : '📚 Finalize & Add Article →'}
        </button>
      </div>
    </div>
  )
}
