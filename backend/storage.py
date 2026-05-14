"""
Save user corrections to JSONL for future retraining.
"""

import json
import datetime
from pathlib import Path

from config import CORRECTIONS_FILE


def save_correction(record: dict) -> str:
    """Append a correction record to the corrections JSONL file."""
    record = {**record, "timestamp": datetime.datetime.utcnow().isoformat()}
    path = Path(CORRECTIONS_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return str(path)
