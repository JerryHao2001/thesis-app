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
