"""
Cross-document coreference resolution using the trained cross-encoder.
Adapted from demo/coref_resolver.py for the new backend.
"""

import os
import sys
from pathlib import Path
from typing import List, Dict, Tuple, Any

import numpy as np
import torch
from transformers import AutoTokenizer

from config import CDCR_CHECKPOINT, NULL_SIGNATURE

# Allow importing from top-level models/ directory
_ROOT = Path(__file__).parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from models.signature_crossencoder import SignatureCorefCrossEncoder


# ─── Model loading ─────────────────────────────────────────────────────────────

def load_cdcr_model(
    checkpoint: str = None,
    bert_model: str = "allenai/scibert_scivocab_uncased",
    device: str = None,
) -> Tuple[Any, AutoTokenizer, torch.device]:
    """Load trained cross-encoder model + tokenizer from checkpoint."""
    checkpoint = os.path.abspath(checkpoint or CDCR_CHECKPOINT)
    device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))

    ckpt = torch.load(checkpoint, map_location="cpu")
    if not isinstance(ckpt, dict) or "state_dict" not in ckpt:
        raise ValueError(
            f"Checkpoint must be a dict with 'state_dict'. Got: "
            f"{list(ckpt.keys()) if isinstance(ckpt, dict) else type(ckpt)}"
        )

    ckpt_args = ckpt.get("args", {}) or {}
    bert_model = bert_model or ckpt_args.get("bert_model", "allenai/scibert_scivocab_uncased")
    tokenizer_name = ckpt_args.get("tokenizer_name") or bert_model
    adapter_name = ckpt_args.get("adapter_name", None)
    mlp_hidden = int(ckpt_args.get("mlp_hidden", 256))
    mlp_layers = int(ckpt_args.get("mlp_layers", 2))

    tokenizer = AutoTokenizer.from_pretrained(tokenizer_name, use_fast=True)

    sig_tokens = ckpt.get("signature_special_tokens") or [
        "<m>", "</m>", "<M>", "<CANON>", "<TYPE>", "<CTX>",
        "<ALIASES>", "<OUT>", "<IN>", "<CO>", "<CAN_CTX>", "<NULL_ANT>",
    ]
    tokenizer.add_special_tokens({"additional_special_tokens": list(sig_tokens)})

    model = SignatureCorefCrossEncoder(
        bert_model=bert_model,
        adapter_name=adapter_name,
        mlp_hidden=mlp_hidden,
        mlp_layers=mlp_layers,
    )
    model.bert.resize_token_embeddings(len(tokenizer))
    model.load_state_dict(ckpt["state_dict"], strict=True)
    model = model.to(device)
    model.eval()

    return model, tokenizer, device


# ─── Scoring ───────────────────────────────────────────────────────────────────

def _score_pair(
    model: Any,
    tokenizer: AutoTokenizer,
    sig_i: str,
    sig_j: str,
    device: torch.device,
    max_length: int = 512,
) -> float:
    enc = tokenizer(
        sig_i, text_pair=sig_j,
        padding=True, truncation=True,
        max_length=max_length, return_tensors="pt",
    )
    input_ids = enc["input_ids"].to(device)
    attn = enc["attention_mask"].to(device)
    tti = enc.get("token_type_ids")
    if tti is not None:
        tti = tti.to(device)
    with torch.no_grad():
        logit = model(input_ids=input_ids, attention_mask=attn, token_type_ids=tti)
    return float(logit[0].item())


# ─── Greedy resolver (cross-doc only) ─────────────────────────────────────────

def resolve_cross_doc(
    model: Any,
    tokenizer: AutoTokenizer,
    device: torch.device,
    doc1_sigs: List[Dict],
    doc2_sigs: List[Dict],
    cand_window: int = 15,
    max_length: int = 512,
) -> Dict:
    """
    Greedy left-to-right resolution with cross-doc-only constraint.

    Mentions are ordered [doc1..., doc2...]. For each doc2 mention,
    candidates are only doc1 mentions within the window (and vice versa
    for any doc1 mentions that appear after doc2 mentions — but since
    ordering is doc1-first, only doc2→doc1 links are possible here).

    Returns:
        {
          "cross_doc_links": [...],
          "cluster_labels": [...],
        }
    """
    all_sigs = doc1_sigs + doc2_sigs
    signatures = [r["signature"] for r in all_sigs]
    mention_texts = [r["mention_text"] for r in all_sigs]
    mention_ids = [r["unique_id"] for r in all_sigs]
    mention_doc_ids = [r["doc_id"] for r in all_sigs]
    n = len(all_sigs)

    cluster_labels = list(range(n))
    cluster_members: Dict[int, List[int]] = {i: [i] for i in range(n)}
    next_cluster_id = n
    decisions: List[Dict] = []

    for i in range(n):
        current_doc = mention_doc_ids[i]
        cand_start = max(0, i - cand_window)
        cand_indices = [
            j for j in range(cand_start, i)
            if mention_doc_ids[j] != current_doc
        ]

        if not cand_indices:
            decisions.append({"mention_idx": i, "decision": "NEW", "linked_to": -1})
            continue

        sig_i = signatures[i]
        null_logit = _score_pair(model, tokenizer, sig_i, NULL_SIGNATURE, device, max_length)

        cand_logits = [
            _score_pair(model, tokenizer, sig_i, signatures[j], device, max_length)
            for j in cand_indices
        ]

        best_idx = int(np.argmax(cand_logits))
        best_logit = cand_logits[best_idx]

        if best_logit > null_logit:
            best_global = cand_indices[best_idx]
            best_cluster = cluster_labels[best_global]
            cluster_labels[i] = best_cluster
            cluster_members.setdefault(best_cluster, []).append(i)

            probs = torch.softmax(
                torch.tensor([null_logit, best_logit], dtype=torch.float32), dim=0
            ).tolist()
            decisions.append({
                "mention_idx": i,
                "decision": "LINK",
                "linked_to": best_global,
                "cluster_id": best_cluster,
                "link_score": best_logit,
                "null_score": null_logit,
                "p_link": probs[1],
            })
        else:
            cluster_labels[i] = next_cluster_id
            cluster_members[next_cluster_id] = [i]
            next_cluster_id += 1
            decisions.append({
                "mention_idx": i,
                "decision": "NEW",
                "linked_to": -1,
                "null_score": null_logit,
            })

    # Extract cross-doc links from final clusters
    clusters: Dict[int, List[int]] = {}
    for i, cid in enumerate(cluster_labels):
        clusters.setdefault(cid, []).append(i)

    cross_doc_links = []
    for cid, members in clusters.items():
        if len(members) < 2:
            continue
        by_doc: Dict[int, List[int]] = {}
        for idx in members:
            by_doc.setdefault(mention_doc_ids[idx], []).append(idx)
        if len(by_doc) < 2:
            continue
        doc_ids_sorted = sorted(by_doc.keys())
        for d1 in range(len(doc_ids_sorted)):
            for d2 in range(d1 + 1, len(doc_ids_sorted)):
                for idx1 in by_doc[doc_ids_sorted[d1]]:
                    for idx2 in by_doc[doc_ids_sorted[d2]]:
                        dec = next(
                            (d for d in decisions if d["mention_idx"] == idx2), None
                        )
                        score = dec.get("p_link", 0.5) if dec else 0.5
                        cross_doc_links.append({
                            "mention_1_id": mention_ids[idx1],
                            "mention_1_text": mention_texts[idx1],
                            "mention_1_doc": mention_doc_ids[idx1],
                            "mention_2_id": mention_ids[idx2],
                            "mention_2_text": mention_texts[idx2],
                            "mention_2_doc": mention_doc_ids[idx2],
                            "cluster_id": cid,
                            "score": score,
                        })

    return {
        "cross_doc_links": cross_doc_links,
        "cluster_labels": cluster_labels,
    }
