import { useState } from 'react'
import DocumentPanel from './DocumentPanel.jsx'
import { apiResolve } from '../api.js'

export default function ReviewStage({ doc1, doc2, setDoc1, setDoc2, onResolved }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const canResolve =
    doc1?.signatures?.length > 0 && doc2?.signatures?.length > 0

  async function handleResolve() {
    setError('')
    setLoading(true)
    try {
      const result = await apiResolve(doc1.signatures, doc2.signatures)
      onResolved(result)
    } catch (e) {
      setError(`Resolution failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="review-header">
        <h2>🔍 Review Extractions</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {error && <span style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</span>}
          <button
            className="btn-success"
            onClick={handleResolve}
            disabled={loading || !canResolve}
            title={canResolve ? 'Run cross-document coreference resolution' : 'Extract entities first'}
          >
            {loading
              ? <><span className="spinner" />Resolving…</>
              : '🔗 Resolve Cross-Document Coreferences'}
          </button>
        </div>
      </div>

      <div className="two-col">
        <DocumentPanel
          docNum={1}
          docData={doc1}
          onUpdate={setDoc1}
        />
        <DocumentPanel
          docNum={2}
          docData={doc2}
          onUpdate={setDoc2}
        />
      </div>

      <div style={{ marginTop: 14, color: 'var(--muted)', fontSize: 12, textAlign: 'center' }}>
        Edit either TANL output and click <strong>Fix</strong> to update the graph.
        When satisfied, click <strong>Resolve</strong> to run cross-document coreference.
      </div>
    </div>
  )
}
