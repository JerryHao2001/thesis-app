import { useState } from 'react'
import InputStage from './components/InputStage.jsx'
import ReviewStage from './components/ReviewStage.jsx'
import ResolvedStage from './components/ResolvedStage.jsx'

/**
 * Top-level state shape:
 *   doc1 / doc2: {
 *     text, tanl_er, tanl_coref,
 *     entities, relations, graph, signatures
 *   }
 *   resolved: { cross_doc_links, cluster_labels }
 */
export default function App() {
  const [stage, setStage] = useState('input')   // 'input' | 'review' | 'resolved'
  const [doc1, setDoc1] = useState(null)
  const [doc2, setDoc2] = useState(null)
  const [resolved, setResolved] = useState(null)

  function handleExtracted(d1, d2) {
    setDoc1(d1)
    setDoc2(d2)
    setResolved(null)
    setStage('review')
  }

  function handleResolved(result) {
    setResolved(result)
    setStage('resolved')
  }

  function handleReset() {
    setStage('input')
    setDoc1(null)
    setDoc2(null)
    setResolved(null)
  }

  return (
    <div>
      <header className="app-header">
        <div>
          <h1>Cross-Document Coreference Resolution</h1>
          <div className="subtitle">TANL extraction · Knowledge graph · Cross-encoder CDCR</div>
        </div>
        {stage !== 'input' && (
          <button className="btn-secondary" onClick={handleReset} style={{ marginLeft: 'auto' }}>
            ← New Session
          </button>
        )}
      </header>

      <main className="app-main">
        {stage === 'input' && (
          <InputStage onExtracted={handleExtracted} />
        )}
        {(stage === 'review' || stage === 'resolved') && (
          <ReviewStage
            doc1={doc1}
            doc2={doc2}
            setDoc1={setDoc1}
            setDoc2={setDoc2}
            onResolved={handleResolved}
          />
        )}
        {stage === 'resolved' && resolved && (
          <ResolvedStage doc1={doc1} doc2={doc2} resolved={resolved} />
        )}
      </main>
    </div>
  )
}
