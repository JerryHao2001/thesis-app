from pathlib import Path

ROOT = Path(__file__).parent.parent  # thesis-app/

TANL_MODEL_DIR = str(ROOT / "tanl-scierc_all-backbone")
CDCR_CHECKPOINT = str(ROOT / "cdcr_ckpts.pt")
CORRECTIONS_FILE = str(ROOT / "corrections.jsonl")

VALID_ENTITY_TYPES = frozenset({
    "task", "method", "metric", "material", "other scientific term", "generic"
})

VALID_RELATION_TYPES = frozenset({
    "used for", "feature of", "hyponym of", "part of",
    "evaluate for", "compare", "conjunction",
})

BIDIRECTIONAL_RELATIONS = frozenset({"compare", "conjunction"})

# Skip mentions longer than this (hallucination guard)
MAX_MENTION_LEN = 80
# If total TANL output exceeds this, treat as hallucination and return empty
MAX_TANL_OUTPUT_LEN = 4000

NULL_SIGNATURE = "<NULL_ANT> no antecedent </NULL_ANT>"
