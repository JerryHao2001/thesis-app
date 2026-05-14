import { useState, useMemo } from 'react'
import GraphViewer, { ENTITY_COLORS, MERGED_NODE_BORDER } from './GraphViewer.jsx'
import DocumentPanel from './DocumentPanel.jsx'
import { apiExtract, apiResolve, apiUnifySigs } from '../api.js'
import { mergeGraphs, applyMerges } from '../graphUtils.js'

// ─── KB tab ───────────────────────────────────────────────────────────────────

function KbTab({ kb }) {
  return (
    <div>
      {/* Article chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {kb.articles.map((a, i) => (
          <span key={i} className="badge" style={{ background: '#eff6ff', color: '#1d4ed8', fontSize: 12, padding: '4px 12px' }}>
            Article {i + 1}
          </span>
        ))}
        <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
          · Round {kb.round} complete · {kb.all_links.length} total cross-doc link{kb.all_links.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Unified graph */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Unified Knowledge Graph</div>
        <div className="card-body">
          <GraphViewer graph={kb.unified_graph} height={440} showDocBorders={false} />
          <div style={{ marginTop: 12 }}>
            <KbLegend />
          </div>
        </div>
      </div>

      {/* All links table */}
      <div className="card">
        <div className="card-header">All Coreference Links</div>
        <div className="card-body">
          <AllLinksTable links={kb.all_links} />
        </div>
      </div>
    </div>
  )
}

function KbLegend() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
      <div className="legend">
        <div className="legend-item">
          <div style={{ width: 18, height: 14, border: `4px solid ${MERGED_NODE_BORDER}`, background: 'transparent', borderRadius: '50%', flexShrink: 0 }} />
          <span>Merged node</span>
        </div>
      </div>
    </div>
  )
}

function AllLinksTable({ links }) {
  if (!links || links.length === 0) {
    return <div className="empty">No cross-document links recorded.</div>
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Mention 1</th>
          <th>Mention 2</th>
          <th>Confidence</th>
          <th>Cluster</th>
        </tr>
      </thead>
      <tbody>
        {links.map((link, i) => (
          <tr key={i}>
            <td><strong>{link.mention_1_text}</strong></td>
            <td><strong>{link.mention_2_text}</strong></td>
            <td>
              <div className="score-bar">
                <div className="score-fill" style={{ width: `${Math.round(link.score * 80)}px` }} />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{(link.score * 100).toFixed(1)}%</span>
              </div>
            </td>
            <td style={{ color: 'var(--muted)', fontSize: 12 }}>#{link.cluster_id}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── Add Article tab ──────────────────────────────────────────────────────────

function AddArticleTab({ kb, onKbUpdate }) {
  const [inputText, setInputText] = useState(
    'XLNet is a pre-training method that extends BERT by using permutation language modeling ' +
    'instead of masked language modeling. It captures bidirectional context and is evaluated on ' +
    'GLUE and SQuAD, outperforming BERT on most tasks.'
  )
  const [newDoc, setNewDoc] = useState(null)
  const [newResolved, setNewResolved] = useState(null)
  const [newActiveLinks, setNewActiveLinks] = useState([])
  const [newThreshold, setNewThreshold] = useState(100)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')

  const newArticleId = kb.articles.length  // 0-indexed
  // Use a unique doc_id per article so unique_ids never collide with existing KB nodes.
  // Display styling uses is_new_article flag instead of doc_id === 1.
  const newArticleDocId = kb.articles.length

  function _markNewArticleNodes(graph) {
    return {
      ...graph,
      nodes: graph.nodes.map(n => ({ ...n, is_new_article: true })),
    }
  }

  async function handleExtract() {
    if (!inputText.trim()) return
    setError('')
    setLoading(true)
    try {
      const result = await apiExtract(inputText, newArticleDocId)
      setNewDoc({ text: inputText, ...result, graph: _markNewArticleNodes(result.graph) })
      setNewResolved(null)
      setNewActiveLinks([])
    } catch (e) {
      setError(`Extraction failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  // Preserve is_new_article flag when DocumentPanel calls onUpdate after Fix
  function handleNewDocUpdate(updated) {
    setNewDoc({ ...updated, graph: _markNewArticleNodes(updated.graph) })
  }

  async function handleResolve() {
    if (!newDoc?.signatures?.length) return
    setError('')
    setLoading(true)
    try {
      const result = await apiResolve(kb.unified_sigs, newDoc.signatures)
      setNewResolved(result)
      setNewActiveLinks(result.cross_doc_links ?? [])
      setNewThreshold(100)
    } catch (e) {
      setError(`Resolution failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm() {
    setError('')
    setConfirming(true)
    try {
      const mergedLinks = newActiveLinks.filter(l => l.score * 100 > newThreshold)
      const mergedPairs = mergedLinks.map(l => ({
        mention_1_id: l.mention_1_id,
        mention_2_id: l.mention_2_id,
      }))

      // Build new unified sigs
      const new_unified_sigs = await apiUnifySigs(
        kb.unified_sigs,
        newDoc.signatures,
        mergedPairs,
      )

      // Build new unified graph
      const baseGraph = mergeGraphs(kb.unified_graph, newDoc.graph, 'kb', 'new')
      const merged = applyMerges(baseGraph, mergedLinks)
      const new_unified_graph = {
        nodes: merged.nodes.map(({ is_new_article: _, ...n }) => ({ ...n, doc_id: 0 })),
        edges: merged.edges,
      }

      onKbUpdate(prev => ({
        ...prev,
        articles: [...prev.articles, { id: newArticleId, text: newDoc.text }],
        unified_graph: new_unified_graph,
        unified_sigs: new_unified_sigs,
        all_links: [...prev.all_links, ...newActiveLinks],
        round: prev.round + 1,
      }))

      // Reset add-article state for next article
      setInputText('')
      setNewDoc(null)
      setNewResolved(null)
      setNewActiveLinks([])
    } catch (e) {
      setError(`Confirm failed: ${e.message}`)
    } finally {
      setConfirming(false)
    }
  }

  // Preview graph (KB + new article, with merges applied)
  const newMergedLinks = newActiveLinks.filter(l => l.score * 100 > newThreshold)
  const newDashedLinks  = newActiveLinks.filter(l => l.score * 100 <= newThreshold)

  const previewGraph = useMemo(() => {
    if (!newDoc || !newResolved) return null
    const base = mergeGraphs(kb.unified_graph, newDoc.graph, 'kb', 'new')
    return applyMerges(base, newMergedLinks)
  }, [kb.unified_graph, newDoc?.graph, newMergedLinks])

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      {/* Step 1: Input */}
      {!newDoc && (
        <div className="card">
          <div className="card-header">Article {newArticleId + 1} — Input</div>
          <div className="card-body">
            <div className="section-label">Paste or type the new article paragraph</div>
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              placeholder="Paste a scientific paragraph…"
              style={{ height: 160, marginBottom: 12 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="btn-primary"
                onClick={handleExtract}
                disabled={loading || !inputText.trim()}
              >
                {loading ? <><span className="spinner" />Extracting…</> : '⚡ Extract'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Review extraction */}
      {newDoc && (
        <>
          <DocumentPanel
            docNum={newArticleId + 1}
            docData={newDoc}
            onUpdate={handleNewDocUpdate}
          />

          {/* Resolve button */}
          {!newResolved && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                className="btn-primary"
                onClick={handleResolve}
                disabled={loading || !newDoc?.signatures?.length}
              >
                {loading ? <><span className="spinner" />Resolving…</> : '🔗 Resolve into Knowledge Base'}
              </button>
            </div>
          )}
        </>
      )}

      {/* Step 3: Resolve results + confirm */}
      {newResolved && (
        <div style={{ marginTop: 20 }}>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              Resolution Preview
              <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}>
                {newActiveLinks.length} link{newActiveLinks.length !== 1 ? 's' : ''} · {newMergedLinks.length} merged
              </span>
            </div>
            <div className="card-body">
              {/* Threshold slider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>All merged</span>
                <input
                  type="range" min={0} max={100} value={newThreshold}
                  onChange={e => setNewThreshold(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>None merged</span>
                <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', minWidth: 100, textAlign: 'right' }}>
                  Threshold: {newThreshold}%
                </span>
              </div>

              {/* Preview graph */}
              <GraphViewer
                graph={previewGraph}
                crossDocLinks={newDashedLinks}
                height={400}
                showDocBorders
              />

              {/* Links table */}
              {newActiveLinks.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div className="section-label">New Links Found</div>
                  <table>
                    <thead>
                      <tr>
                        <th>KB Mention</th>
                        <th>Article {newArticleId + 1} Mention</th>
                        <th>Confidence</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {newActiveLinks.map((link, i) => {
                        const pct = link.score * 100
                        const isMerged = pct > newThreshold
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
                            <td>
                              {isMerged
                                ? <span className="badge" style={{ background: '#ede9fe', color: '#6d28d9' }}>merged</span>
                                : <span className="badge" style={{ background: '#f3f4f6', color: '#6b7280' }}>linked</span>}
                            </td>
                            <td>
                              <button
                                className="btn-secondary"
                                style={{ padding: '3px 10px', fontSize: 11 }}
                                onClick={() => setNewActiveLinks(prev => prev.filter((_, j) => j !== i))}
                              >
                                Unlink
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <button
              className="btn-secondary"
              onClick={() => { setNewResolved(null); setNewActiveLinks([]) }}
              disabled={confirming}
            >
              ← Re-resolve
            </button>
            <button
              className="btn-success"
              onClick={handleConfirm}
              disabled={confirming}
            >
              {confirming
                ? <><span className="spinner" />Adding to KB…</>
                : `✅ Confirm & Add Article ${newArticleId + 1} to KB`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function KnowledgeBaseStage({ kb, onKbUpdate }) {
  const [activeTab, setActiveTab] = useState('kb')

  return (
    <div>
      <div className="tab-bar">
        <button
          className={`tab-btn ${activeTab === 'kb' ? 'active' : ''}`}
          onClick={() => setActiveTab('kb')}
        >
          📚 Knowledge Base
          <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }}>
            ({kb.articles.length} articles)
          </span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'add' ? 'active' : ''}`}
          onClick={() => setActiveTab('add')}
        >
          ➕ Add Article {kb.articles.length + 1}
        </button>
      </div>

      {/* Both tabs stay mounted so in-progress work survives tab switching */}
      <div style={{ display: activeTab === 'kb' ? 'block' : 'none' }}>
        <KbTab kb={kb} />
      </div>
      <div style={{ display: activeTab === 'add' ? 'block' : 'none' }}>
        <AddArticleTab kb={kb} onKbUpdate={onKbUpdate} />
      </div>
    </div>
  )
}
