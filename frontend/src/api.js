const BASE = '/api'

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function apiExtract(text, docId) {
  return post('/extract', { text, doc_id: docId })
}

export async function apiRebuild(text, docId, tanlEr, tanlCoref) {
  return post('/rebuild', { text, doc_id: docId, tanl_er: tanlEr, tanl_coref: tanlCoref })
}

export async function apiSaveCorrection(record) {
  return post('/save_correction', record)
}

export async function apiResolve(doc1Signatures, doc2Signatures) {
  return post('/resolve', {
    doc1_signatures: doc1Signatures,
    doc2_signatures: doc2Signatures,
  })
}

export async function apiHealth() {
  const res = await fetch(`${BASE}/health`)
  return res.json()
}
