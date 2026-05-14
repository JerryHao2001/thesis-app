"""
TANL extraction pipeline + parsing + validation + WD-coref merging.
"""

import re
import os
import hashlib
import torch
from dataclasses import dataclass, field
from typing import List, Dict, Tuple, Set, Optional
from collections import defaultdict
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

from config import (
    TANL_MODEL_DIR,
    VALID_ENTITY_TYPES,
    VALID_RELATION_TYPES,
    BIDIRECTIONAL_RELATIONS,
    MAX_MENTION_LEN,
    MAX_TANL_OUTPUT_LEN,
)


# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class ExtractedEntity:
    text: str
    entity_type: str
    start_char: int = -1
    end_char: int = -1
    doc_id: int = 0
    para_id: int = 0
    unique_id: str = field(default="", init=False)

    def __post_init__(self):
        h = hashlib.md5(self.text.encode()).hexdigest()[:8]
        self.unique_id = f"d{self.doc_id}_p{self.para_id}_{h}"


@dataclass
class ExtractedRelation:
    subject: str
    predicate: str
    obj: str
    subject_type: str = ""
    bidirectional: bool = False


# ─── Text helpers ──────────────────────────────────────────────────────────────

def _normalize(s: str) -> str:
    s = (s or "").lower().strip()
    return re.sub(r"\s+", " ", s)


def _is_valid_mention(text: str) -> bool:
    text = (text or "").strip()
    return bool(text) and len(text) <= MAX_MENTION_LEN


# ─── TANL pipeline ────────────────────────────────────────────────────────────

class TANLPipeline:
    def __init__(self, model_dir: str = None, device: str = None):
        model_dir = os.path.abspath(model_dir or TANL_MODEL_DIR)
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.tokenizer = AutoTokenizer.from_pretrained("t5-base")
        self.model = AutoModelForSeq2SeqLM.from_pretrained(model_dir).to(self.device)
        self.model.eval()

    def extract(
        self,
        text: str,
        task: str = "scierc_joint_er",
        num_beams: int = 4,
        max_input_len: int = 512,
        max_output_len: int = 1024,
    ) -> str:
        inp = f"{task}: {text.strip()}"
        enc = self.tokenizer(
            inp, return_tensors="pt", truncation=True, max_length=max_input_len
        )
        enc = {k: v.to(self.device) for k, v in enc.items()}
        with torch.no_grad():
            out = self.model.generate(
                **enc,
                num_beams=num_beams,
                max_length=max_output_len,
                early_stopping=True,
                do_sample=False,
            )
        return self.tokenizer.decode(out[0], skip_special_tokens=True)


# ─── TANL output parsers ───────────────────────────────────────────────────────

_JOINT_ER_RE = re.compile(
    r"\[\s*(?P<mention>[^|\]]+?)\s*\|\s*(?P<etype>[^|\]]+?)"
    r"(?:\s*\|\s*(?P<rels>.+?))?\s*\]"
)
# ante is optional: [ BERT ] is a self-referential first mention (no pipe)
_COREF_RE = re.compile(
    r"\[\s*(?P<mention>[^|\]]+?)\s*(?:\|\s*(?P<ante>[^|\]]+?)\s*)?\]"
)


def _parse_rels(rels_str: str) -> List[Tuple[str, str]]:
    """Parse 'pred=obj | pred=obj ...' relation string."""
    rels: List[Tuple[str, str]] = []
    for chunk in re.split(r"\s*\|\s*", rels_str or ""):
        chunk = chunk.strip()
        if "=" not in chunk:
            continue
        pred, obj = chunk.split("=", 1)
        pred = _normalize(pred)
        obj = obj.strip()
        if pred in VALID_RELATION_TYPES and _is_valid_mention(obj):
            rels.append((pred, obj))
    return rels


def parse_joint_er(tanl_text: str) -> List[Dict]:
    """
    Parse scierc_joint_er output: [ mention | TYPE | pred=obj | ... ]
    Validates entity types; coerces unknown types to 'generic'.
    Returns [] if output looks like a hallucination (too long).
    """
    if len(tanl_text or "") > MAX_TANL_OUTPUT_LEN:
        return []
    results = []
    for m in _JOINT_ER_RE.finditer(tanl_text or ""):
        mention = (m.group("mention") or "").strip()
        etype = _normalize(m.group("etype") or "")
        rels_str = m.group("rels") or ""
        if not _is_valid_mention(mention):
            continue
        if etype not in VALID_ENTITY_TYPES:
            etype = "generic"
        results.append({"text": mention, "type": etype, "rels_out": _parse_rels(rels_str)})
    return results


def parse_coref(tanl_text: str) -> List[Dict]:
    """
    Parse scierc_coref output: [ mention | antecedent ]
    Returns [] if output looks like a hallucination (too long).
    """
    if len(tanl_text or "") > MAX_TANL_OUTPUT_LEN:
        return []
    results = []
    for m in _COREF_RE.finditer(tanl_text or ""):
        mention = (m.group("mention") or "").strip()
        ante = (m.group("ante") or "").strip()
        if _is_valid_mention(mention):
            results.append({"text": mention, "ante": ante or mention})
    return results


# ─── Within-document coref clustering ────────────────────────────────────────

class _UnionFind:
    def __init__(self, n: int):
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x: int) -> int:
        if self.parent[x] != x:
            self.parent[x] = self.find(self.parent[x])
        return self.parent[x]

    def union(self, a: int, b: int):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            self.parent[ra] = rb
        elif self.rank[ra] > self.rank[rb]:
            self.parent[rb] = ra
        else:
            self.parent[rb] = ra
            self.rank[ra] += 1


def _build_wd_clusters(
    occ: List[Dict],
) -> Tuple[Dict[int, str], Dict[int, List[str]]]:
    """
    Build WD coref clusters and return text-based maps.

    When TANL omits the first mention from its coref output (e.g. outputs
    only [ It | BERT ] without [ BERT | BERT ]), the antecedent "BERT" would
    never appear as a cluster member, so min-index selection would incorrectly
    pick "It" as canonical.  Fix: prepend a virtual self-referential entry for
    every antecedent that is not already present as a mention text.  Because
    these entries are prepended they always win the min-index selection.

    Returns:
        cluster_canon  – {cluster_id: canonical_text}
        cluster_members – {cluster_id: [all member texts including virtual]}
    """
    # Prepend virtual entries for antecedents absent from the mention list
    known = {_normalize(o["text"]) for o in occ}
    seen_virtual: Set[str] = set()
    virtual: List[Dict] = []
    for o in occ:
        ante = o.get("ante", o["text"])
        ante_norm = _normalize(ante)
        if ante_norm not in known and ante_norm not in seen_virtual:
            virtual.append({"text": ante, "ante": ante})
            seen_virtual.add(ante_norm)

    all_occ = virtual + list(occ)
    n = len(all_occ)
    uf = _UnionFind(n)
    norm_texts = [_normalize(o["text"]) for o in all_occ]

    for i in range(n):
        ante_norm = _normalize(all_occ[i].get("ante", all_occ[i]["text"]))
        for k in range(i - 1, -1, -1):
            if norm_texts[k] == ante_norm:
                uf.union(i, k)
                break

    root_to_cid: Dict[int, int] = {}
    occ2cluster: List[int] = []
    for i in range(n):
        r = uf.find(i)
        if r not in root_to_cid:
            root_to_cid[r] = len(root_to_cid)
        occ2cluster.append(root_to_cid[r])

    clusters: Dict[int, List[int]] = defaultdict(list)
    for i, cid in enumerate(occ2cluster):
        clusters[cid].append(i)

    cluster_canon  = {cid: all_occ[min(members)]["text"] for cid, members in clusters.items()}
    cluster_members = {cid: [all_occ[i]["text"] for i in members] for cid, members in clusters.items()}
    return cluster_canon, cluster_members


# ─── Main merge function ───────────────────────────────────────────────────────

def merge_tanl_results(
    typed_tanl: str,
    coref_tanl: str,
    original_text: str,
    doc_id: int = 0,
    para_id: int = 0,
) -> Tuple[List[ExtractedEntity], List[ExtractedRelation]]:
    """
    Merge scierc_joint_er + scierc_coref TANL outputs into entities + relations.

    Strategy:
      1. Build WD coref clusters from coref output
      2. Parse entity/relation from joint_er output
      3. Canonicalize entity mentions via coref clusters
      4. Return deduplicated entities + validated relations
    """
    # Step 1: WD coref clusters
    coref_mentions = parse_coref(coref_tanl)
    coref_by_cluster: Dict[int, List[str]] = {}
    coref_cluster_canon: Dict[int, str] = {}

    if coref_mentions:
        coref_cluster_canon, coref_by_cluster = _build_wd_clusters(coref_mentions)

    # Step 2 & 3: Parse joint_er, canonicalize via coref
    entities_dict: Dict[str, ExtractedEntity] = {}
    relations: List[ExtractedRelation] = []
    seen_rels: Set[Tuple[str, str, str]] = set()

    for ent_dict in parse_joint_er(typed_tanl):
        mention_text = ent_dict["text"]
        entity_type = ent_dict["type"]

        canonical = mention_text
        for cid, members in coref_by_cluster.items():
            if any(_normalize(m) == _normalize(mention_text) for m in members):
                canonical = coref_cluster_canon[cid]
                break


        norm = _normalize(canonical)
        if norm not in entities_dict:
            entities_dict[norm] = ExtractedEntity(
                text=canonical, entity_type=entity_type, doc_id=doc_id, para_id=para_id
            )
        elif entity_type != "generic" and entities_dict[norm].entity_type == "generic":
            entities_dict[norm].entity_type = entity_type

        for pred, obj_text in ent_dict.get("rels_out", []):
            # Canonicalize the object through coref clusters too,
            # so edges like (masked_lm → used_for → It) become
            # (masked_lm → used_for → BERT) instead of being dropped.
            canonical_obj = obj_text
            for cid, members in coref_by_cluster.items():
                if any(_normalize(m) == _normalize(obj_text) for m in members):
                    canonical_obj = coref_cluster_canon[cid]
                    break

            key = (_normalize(canonical), pred, _normalize(canonical_obj))
            if key not in seen_rels:
                seen_rels.add(key)
                relations.append(ExtractedRelation(
                    subject=canonical,
                    predicate=pred,
                    obj=canonical_obj,
                    subject_type=entity_type,
                    bidirectional=pred in BIDIRECTIONAL_RELATIONS,
                ))

    # Step 4: Add coref-only mentions not caught by joint_er
    for cid, members in coref_by_cluster.items():
        canon = coref_cluster_canon[cid]
        norm = _normalize(canon)
        if norm not in entities_dict:
            entities_dict[norm] = ExtractedEntity(
                text=canon, entity_type="generic", doc_id=doc_id, para_id=para_id
            )

    # Step 5: Compute character offsets
    for entity in entities_dict.values():
        matches = list(re.finditer(re.escape(entity.text), original_text, re.IGNORECASE))
        if matches:
            entity.start_char = matches[0].start()
            entity.end_char = matches[0].end()

    return list(entities_dict.values()), relations
