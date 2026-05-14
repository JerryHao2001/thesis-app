"""
FastAPI backend for the Cross-Document Coreference Resolution web app.
"""

from contextlib import asynccontextmanager
from typing import List, Optional

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from extraction import TANLPipeline, merge_tanl_results
from graph_builder import build_graph
from signatures import build_signatures, build_unified_sigs as _build_unified_sigs
from coref import load_cdcr_model, resolve_cross_doc
from storage import save_correction


# ─── Global model state (loaded once at startup) ───────────────────────────────

_tanl: Optional[TANLPipeline] = None
_cdcr_model = None
_cdcr_tokenizer = None
_cdcr_device = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _tanl, _cdcr_model, _cdcr_tokenizer, _cdcr_device
    print("Loading TANL model...")
    _tanl = TANLPipeline()
    print("TANL model loaded.")
    print("Loading CDCR model...")
    _cdcr_model, _cdcr_tokenizer, _cdcr_device = load_cdcr_model()
    print("CDCR model loaded.")
    yield


app = FastAPI(title="CDCR Demo API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Schemas ───────────────────────────────────────────────────────────────────

class ExtractRequest(BaseModel):
    text: str
    doc_id: int


class RebuildRequest(BaseModel):
    text: str
    doc_id: int
    tanl_er: str
    tanl_coref: str


class SaveCorrectionRequest(BaseModel):
    doc_id: int
    text: str
    original_er: str
    original_coref: str
    fixed_er: str
    fixed_coref: str


class SigRecord(BaseModel):
    mention_text: str
    entity_type: str
    signature: str
    doc_id: int
    para_id: int = 0
    unique_id: str


class ResolveRequest(BaseModel):
    doc1_signatures: List[SigRecord]
    doc2_signatures: List[SigRecord]


class MergedPair(BaseModel):
    mention_1_id: str
    mention_2_id: str


class UnifySigsRequest(BaseModel):
    doc1_signatures: List[SigRecord]
    doc2_signatures: List[SigRecord]
    merged_pairs: List[MergedPair]


# ─── Helpers ───────────────────────────────────────────────────────────────────

def _process(text: str, doc_id: int, tanl_er: str, tanl_coref: str) -> dict:
    """Merge TANL outputs → graph + signatures."""
    entities, relations = merge_tanl_results(tanl_er, tanl_coref, text, doc_id)
    graph = build_graph(entities, relations)
    sigs = build_signatures(entities, relations, text, doc_id)
    return {
        "entities": [
            {"id": e.unique_id, "text": e.text, "entity_type": e.entity_type,
             "doc_id": e.doc_id, "start_char": e.start_char, "end_char": e.end_char}
            for e in entities
        ],
        "relations": [
            {"subject": r.subject, "predicate": r.predicate, "obj": r.obj,
             "bidirectional": r.bidirectional}
            for r in relations
        ],
        "graph": graph.to_dict(),
        "signatures": sigs,
    }


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "device": str(_cdcr_device),
        "tanl_loaded": _tanl is not None,
        "cdcr_loaded": _cdcr_model is not None,
    }


@app.post("/api/extract")
def extract(req: ExtractRequest):
    if _tanl is None:
        raise HTTPException(503, "Models not loaded yet")
    try:
        tanl_er = _tanl.extract(req.text, task="scierc_joint_er")
        tanl_coref = _tanl.extract(req.text, task="scierc_coref")
        result = _process(req.text, req.doc_id, tanl_er, tanl_coref)
        return {"doc_id": req.doc_id, "tanl_er": tanl_er, "tanl_coref": tanl_coref, **result}
    except Exception as e:
        raise HTTPException(500, f"Extraction failed: {e}")


@app.post("/api/rebuild")
def rebuild(req: RebuildRequest):
    """Re-parse user-edited TANL text → updated graph + signatures."""
    try:
        result = _process(req.text, req.doc_id, req.tanl_er, req.tanl_coref)
        return result
    except Exception as e:
        raise HTTPException(500, f"Rebuild failed: {e}")


@app.post("/api/save_correction")
def save(req: SaveCorrectionRequest):
    path = save_correction(req.model_dump())
    return {"status": "saved", "file": path}


@app.post("/api/build_unified_sigs")
def build_unified_sigs_endpoint(req: UnifySigsRequest):
    """Merge doc1+doc2 signatures into a unified KB signature list for the next round."""
    try:
        doc1_sigs = [s.model_dump() for s in req.doc1_signatures]
        doc2_sigs = [s.model_dump() for s in req.doc2_signatures]
        merged_pairs = [p.model_dump() for p in req.merged_pairs]
        result = _build_unified_sigs(doc1_sigs, doc2_sigs, merged_pairs)
        return result
    except Exception as e:
        raise HTTPException(500, f"Unify sigs failed: {e}")


@app.post("/api/resolve")
def resolve(req: ResolveRequest):
    if _cdcr_model is None:
        raise HTTPException(503, "CDCR model not loaded yet")
    try:
        doc1_sigs = [s.model_dump() for s in req.doc1_signatures]
        doc2_sigs = [s.model_dump() for s in req.doc2_signatures]
        result = resolve_cross_doc(
            model=_cdcr_model,
            tokenizer=_cdcr_tokenizer,
            device=_cdcr_device,
            doc1_sigs=doc1_sigs,
            doc2_sigs=doc2_sigs,
        )
        return result
    except Exception as e:
        raise HTTPException(500, f"Resolution failed: {e}")
