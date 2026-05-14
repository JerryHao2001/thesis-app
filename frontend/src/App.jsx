import { useState } from 'react'
import InputStage from './components/InputStage.jsx'
import ReviewStage from './components/ReviewStage.jsx'
import ResolvedStage from './components/ResolvedStage.jsx'
import KnowledgeBaseStage from './components/KnowledgeBaseStage.jsx'
import { apiUnifySigs } from './api.js'

/**
 * Top-level state shape:
 *   doc1 / doc2: { text, tanl_er, tanl_coref, entities, relations, graph, signatures }
 *   resolved:    { cross_doc_links, cluster_labels }
 *   kb:          { articles, unified_graph, unified_sigs, all_links, round }
 *
 * Stages: 'input' → 'review' → 'resolved' → (finalize) → 'kb'
 */
export default function App() {
  const [stage, setStage] = useState('input')
  const [doc1, setDoc1] = useState(null)
  const [doc2, setDoc2] = useState(null)
  const [resolved, setResolved] = useState(null)
  const [kb, setKb] = useState(null)

  function handleExtracted(d1, d2) {
    setDoc1(d1)
    setDoc2(d2)
    setResolved(null)
    setKb(null)
    setStage('review')
  }

  function handleResolved(result) {
    setResolved(result)
    setStage('resolved')
  }

  async function handleFinalize(activeLinks, threshold, displayGraph) {
    const mergedLinks = activeLinks.filter(l => l.score * 100 > threshold)
    const mergedPairs = mergedLinks.map(l => ({
      mention_1_id: l.mention_1_id,
      mention_2_id: l.mention_2_id,
    }))

    const unified_sigs = await apiUnifySigs(
      doc1.signatures,
      doc2.signatures,
      mergedPairs,
    )

    // Normalise all KB node doc_ids to 0 so they appear as the "existing" side
    // when a new article (doc_id=1) is added in the next round.
    const unified_graph = {
      nodes: displayGraph.nodes.map(n => ({ ...n, doc_id: 0 })),
      edges: displayGraph.edges,
    }

    setKb({
      articles: [
        { id: 0, text: doc1.text },
        { id: 1, text: doc2.text },
      ],
      unified_graph,
      unified_sigs,
      all_links: activeLinks,
      round: 1,
    })
    setStage('kb')
  }

  function handleReset() {
    setStage('input')
    setDoc1(null)
    setDoc2(null)
    setResolved(null)
    setKb(null)
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
          <ResolvedStage
            doc1={doc1}
            doc2={doc2}
            resolved={resolved}
            onFinalize={handleFinalize}
          />
        )}
        {stage === 'kb' && kb && (
          <KnowledgeBaseStage kb={kb} onKbUpdate={setKb} />
        )}
      </main>
    </div>
  )
}
