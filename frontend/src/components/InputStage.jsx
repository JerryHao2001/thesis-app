import { useState } from 'react'
import { apiExtract } from '../api.js'

export default function InputStage({ onExtracted }) {
  const [text1, setText1] = useState(
    'BERT is a transformer-based language model developed by Google. ' +
    'It uses masked language modeling and next sentence prediction as pre-training objectives. ' +
    'BERT has been applied to question answering, named entity recognition, and text classification. ' +
    'The model achieves state-of-the-art results on the GLUE benchmark and the SQuAD reading comprehension dataset.'
  )
  const [text2, setText2] = useState(
    'RoBERTa is an optimized pre-training method for language models. ' +
    'It removes the next sentence prediction objective used in BERT and trains with larger batch sizes and more data. ' +
    'RoBERTa outperforms BERT on the GLUE benchmark and sets new state-of-the-art results on SQuAD. ' +
    'The model demonstrates that careful tuning of training hyperparameters significantly improves performance.'
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleExtract() {
    if (!text1.trim() || !text2.trim()) {
      setError('Please enter text for both documents.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const [r1, r2] = await Promise.all([
        apiExtract(text1, 0),
        apiExtract(text2, 1),
      ])
      onExtracted(
        { text: text1, ...r1 },
        { text: text2, ...r2 },
      )
    } catch (e) {
      setError(`Extraction failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="input-stage">
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">📄 Input Documents</div>
        <div className="card-body">
          {error && <div className="alert alert-error">{error}</div>}
          <div className="two-col">
            <div>
              <div className="section-label">Document 1</div>
              <textarea
                value={text1}
                onChange={e => setText1(e.target.value)}
                placeholder="Paste or type a scientific paragraph…"
              />
            </div>
            <div>
              <div className="section-label">Document 2</div>
              <textarea
                value={text2}
                onChange={e => setText2(e.target.value)}
                placeholder="Paste or type a second scientific paragraph…"
              />
            </div>
          </div>
          <div className="input-actions">
            <button
              className="btn-primary"
              onClick={handleExtract}
              disabled={loading || !text1.trim() || !text2.trim()}
            >
              {loading ? <><span className="spinner" />Extracting…</> : '⚡ Extract Entities & Relations'}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">ℹ️ How it works</div>
        <div className="card-body" style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
          <ol style={{ paddingLeft: 18 }}>
            <li>Enter two scientific paragraphs and click <strong>Extract</strong>.</li>
            <li>Review the knowledge graph and TANL output for each document. Edit and <strong>Fix</strong> any errors.</li>
            <li>Click <strong>Resolve</strong> to find coreferent entities across documents.</li>
          </ol>
        </div>
      </div>
    </div>
  )
}
