import { useState } from 'react'
import GraphViewer from './GraphViewer.jsx'
import { apiRebuild, apiSaveCorrection } from '../api.js'

const ER_PLACEHOLDER =
  '[ mention | TYPE | pred=obj | pred=obj ]\nExample: [ BERT | method | used for=classification ]'
const COREF_PLACEHOLDER =
  '[ mention | antecedent ]\nExample: [ the model | BERT ]'

export default function DocumentPanel({ docNum, docData, onUpdate }) {
  const [editedEr, setEditedEr] = useState(docData.tanl_er ?? '')
  const [editedCoref, setEditedCoref] = useState(docData.tanl_coref ?? '')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null)   // { type: 'success'|'error', msg }

  // Keep local edit state synced when docData is replaced from outside
  // (e.g. after initial extract). We only sync once when tanl_er/coref change.
  // Intentionally NOT using useEffect to avoid resetting mid-edit.

  async function handleFix() {
    setLoading(true)
    setStatus(null)
    try {
      const result = await apiRebuild(docData.text, docData.doc_id, editedEr, editedCoref)

      // Save correction record (fire-and-forget)
      apiSaveCorrection({
        doc_id: docData.doc_id,
        text: docData.text,
        original_er: docData.tanl_er,
        original_coref: docData.tanl_coref,
        fixed_er: editedEr,
        fixed_coref: editedCoref,
      }).catch(() => {})

      onUpdate({
        ...docData,
        tanl_er: editedEr,
        tanl_coref: editedCoref,
        entities: result.entities,
        relations: result.relations,
        graph: result.graph,
        signatures: result.signatures,
      })

      setStatus({ type: 'success', msg: `Graph updated · ${result.entities.length} entities, ${result.relations.length} relations` })
    } catch (e) {
      setStatus({ type: 'error', msg: e.message })
    } finally {
      setLoading(false)
    }
  }

  const isDirty = editedEr !== (docData.tanl_er ?? '') || editedCoref !== (docData.tanl_coref ?? '')

  return (
    <div className="card">
      <div className="card-header">
        Document {docNum}
        <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}>
          {docData.entities?.length ?? 0} entities · {docData.relations?.length ?? 0} relations
        </span>
      </div>
      <div className="card-body">

        {/* Knowledge graph */}
        <div className="section-label">Knowledge Graph</div>
        <GraphViewer graph={docData.graph} height={300} />

        {/* Entity & Relations TANL output */}
        <div className="section-label" style={{ marginTop: 16 }}>
          Entities &amp; Relations
          <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--muted)' }}>
            — format: [ mention | TYPE | pred=obj ]
          </span>
        </div>
        <textarea
          className="monospace tanl-er"
          value={editedEr}
          onChange={e => setEditedEr(e.target.value)}
          placeholder={ER_PLACEHOLDER}
          style={{ height: 100 }}
        />

        {/* Coreference TANL output */}
        <div className="section-label">
          Within-doc Coreference
          <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--muted)' }}>
            — format: [ mention | antecedent ]
          </span>
        </div>
        <textarea
          className="monospace tanl-coref"
          value={editedCoref}
          onChange={e => setEditedCoref(e.target.value)}
          placeholder={COREF_PLACEHOLDER}
          style={{ height: 80 }}
        />

        {/* Status + Fix button */}
        {status && (
          <div className={`alert alert-${status.type}`} style={{ marginTop: 10 }}>
            {status.msg}
          </div>
        )}
        <div className="fix-btn-row">
          <button
            className="btn-secondary"
            onClick={() => { setEditedEr(docData.tanl_er ?? ''); setEditedCoref(docData.tanl_coref ?? ''); setStatus(null) }}
            disabled={loading || !isDirty}
          >
            Reset
          </button>
          <button
            className="btn-primary"
            onClick={handleFix}
            disabled={loading || !isDirty}
          >
            {loading ? <><span className="spinner" />Updating…</> : '🔧 Fix'}
          </button>
        </div>

      </div>
    </div>
  )
}
