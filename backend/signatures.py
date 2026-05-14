"""
Flat-format signature builder for cross-encoder input.
Adapted from demo/signature_builder_demo.py for the new backend.
"""

import re
from typing import List, Dict

from extraction import ExtractedEntity, ExtractedRelation


def _normalize(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").lower().strip())


def _build_context_window(
    text: str,
    start: int,
    end: int,
    context_size: int = 40,
    max_chars: int = 200,
) -> str:
    pre = text[max(0, start - context_size): start].strip()
    mention = text[start:end]
    post = text[end: end + context_size].lstrip()
    ctx = f"{pre} <m>{mention}</m> {post}".strip()
    return ctx[:max_chars] + ("..." if len(ctx) > max_chars else "")


def build_flat_signature(
    entity: ExtractedEntity,
    paragraph_text: str,
    relations: List[ExtractedRelation],
    all_entities: List[ExtractedEntity],
    max_relations: int = 6,
    max_context_chars: int = 200,
) -> str:
    """
    Build flat signature:
      <M>mention</M> <TYPE>type <OUT>obj=pred | ... <CTX>context
    """
    parts = [f"<M>{entity.text}</M>", f"<TYPE>{entity.entity_type}"]

    out_rels = [
        r for r in relations if _normalize(r.subject) == _normalize(entity.text)
    ]
    if out_rels:
        rel_strs = [f"{r.obj}={r.predicate}" for r in out_rels[:max_relations]]
        parts.append(f"<OUT>{' | '.join(rel_strs)}")

    if entity.start_char >= 0 and entity.end_char >= 0:
        ctx = _build_context_window(
            paragraph_text, entity.start_char, entity.end_char,
            max_chars=max_context_chars
        )
    else:
        ctx = f"<m>{entity.text}</m>"
    parts.append(f"<CTX>{ctx}")

    return " ".join(parts)


# ─── Unified signature merging ────────────────────────────────────────────────

def _extract_out_rels(sig_str: str) -> List[str]:
    """Parse 'obj=pred | obj=pred ...' entries from the <OUT> field."""
    m = re.search(r'<OUT>(.*?)(?=<CTX>|$)', sig_str, re.DOTALL)
    if not m:
        return []
    return [r.strip() for r in m.group(1).split(' | ') if r.strip() and '=' in r]


def _extract_ctx(sig_str: str) -> str:
    """Extract context text from the <CTX> field."""
    m = re.search(r'<CTX>(.*?)$', sig_str, re.DOTALL)
    return m.group(1).strip() if m else ""


def merge_signatures(sig1: Dict, sig2: Dict) -> Dict:
    """
    Merge two signature records from a resolved mention pair into one.

    Rules:
      <M>       — sig1 mention text (doc1 = canonical surviving node)
      <ALIASES> — sig2 mention text if it differs from sig1
      <TYPE>    — prefer non-generic; if both non-generic use sig1
      <OUT>     — union of both relation sets, deduped, capped at 6
      <CTX>     — sig1 context only (avoids token length explosion)
    """
    mention = sig1["mention_text"]
    alias = sig2["mention_text"] if _normalize(sig2["mention_text"]) != _normalize(mention) else ""

    type1, type2 = sig1["entity_type"], sig2["entity_type"]
    entity_type = type1 if type1 != "generic" else type2

    rels1 = _extract_out_rels(sig1["signature"])
    rels2 = _extract_out_rels(sig2["signature"])
    seen: set = set()
    merged_rels: List[str] = []
    for r in rels1 + rels2:
        k = _normalize(r)
        if k not in seen:
            seen.add(k)
            merged_rels.append(r)
    merged_rels = merged_rels[:6]

    ctx = _extract_ctx(sig1["signature"])

    parts = [f"<M>{mention}</M>", f"<TYPE>{entity_type}"]
    if alias:
        parts.append(f"<ALIASES>{alias}")
    if merged_rels:
        parts.append(f"<OUT>{' | '.join(merged_rels)}")
    if ctx:
        parts.append(f"<CTX>{ctx}")

    return {
        "mention_text": mention,
        "entity_type": entity_type,
        "signature": " ".join(parts),
        "doc_id": 0,
        "para_id": sig1.get("para_id", 0),
        "unique_id": sig1["unique_id"],
    }


def build_unified_sigs(
    doc1_sigs: List[Dict],
    doc2_sigs: List[Dict],
    merged_pairs: List[Dict],
) -> List[Dict]:
    """
    Build the unified signature list for the knowledge base after one resolve round.

    merged_pairs: [{ mention_1_id, mention_2_id }] — pairs above the threshold.

    Returns one SigRecord per cluster/node:
      - Merged pairs → merged_signatures (combined info from both sides)
      - Unmerged doc1 nodes → kept as-is, doc_id normalised to 0
      - Unmerged doc2 nodes → kept as-is, doc_id normalised to 0 (join the "existing" side)
    """
    d1_by_id = {s["unique_id"]: s for s in doc1_sigs}
    d2_by_id = {s["unique_id"]: s for s in doc2_sigs}

    merged_d1_ids: set = set()
    merged_d2_ids: set = set()
    result: List[Dict] = []

    for pair in merged_pairs:
        d1_id = pair["mention_1_id"]
        d2_id = pair["mention_2_id"]
        sig1 = d1_by_id.get(d1_id)
        sig2 = d2_by_id.get(d2_id)
        if sig1 and sig2:
            result.append(merge_signatures(sig1, sig2))
            merged_d1_ids.add(d1_id)
            merged_d2_ids.add(d2_id)

    for s in doc1_sigs:
        if s["unique_id"] not in merged_d1_ids:
            result.append({**s, "doc_id": 0})

    for s in doc2_sigs:
        if s["unique_id"] not in merged_d2_ids:
            result.append({**s, "doc_id": 0})

    return result


def build_signatures(
    entities: List[ExtractedEntity],
    relations: List[ExtractedRelation],
    paragraph_text: str,
    doc_id: int,
    para_id: int = 0,
) -> List[Dict]:
    """Return one signature record per entity."""
    records = []
    for entity in entities:
        sig = build_flat_signature(entity, paragraph_text, relations, entities)
        records.append({
            "mention_text": entity.text,
            "entity_type": entity.entity_type,
            "signature": sig,
            "doc_id": doc_id,
            "para_id": para_id,
            "unique_id": entity.unique_id,
        })
    return records
