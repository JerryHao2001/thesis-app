"""
Knowledge graph construction from extracted entities and relations.
"""

from dataclasses import dataclass, asdict
from typing import List, Dict, Optional, Tuple

from extraction import ExtractedEntity, ExtractedRelation


@dataclass
class GraphNode:
    id: str
    label: str
    entity_type: str
    doc_id: int = 0
    frequency: int = 1


@dataclass
class GraphEdge:
    id: str
    source: str
    target: str
    relation_type: str
    doc_id: int = 0
    bidirectional: bool = False


class KnowledgeGraph:
    def __init__(self):
        self.nodes: Dict[str, GraphNode] = {}
        self.edges: List[GraphEdge] = []
        self._edge_ctr = 0

    def add_node(self, node_id: str, label: str, entity_type: str, doc_id: int = 0):
        if node_id in self.nodes:
            self.nodes[node_id].frequency += 1
        else:
            self.nodes[node_id] = GraphNode(
                id=node_id, label=label, entity_type=entity_type, doc_id=doc_id
            )

    def add_edge(
        self,
        source: str,
        target: str,
        relation_type: str,
        doc_id: int = 0,
        bidirectional: bool = False,
    ):
        if source not in self.nodes or target not in self.nodes:
            return
        eid = f"e{self._edge_ctr}"
        self._edge_ctr += 1
        self.edges.append(GraphEdge(
            id=eid,
            source=source,
            target=target,
            relation_type=relation_type,
            doc_id=doc_id,
            bidirectional=bidirectional,
        ))

    def to_dict(self) -> Dict:
        return {
            "nodes": [asdict(n) for n in self.nodes.values()],
            "edges": [asdict(e) for e in self.edges],
        }


def _normalize(s: str) -> str:
    import re
    return re.sub(r"\s+", " ", (s or "").lower().strip())


def build_graph(
    entities: List[ExtractedEntity],
    relations: List[ExtractedRelation],
) -> KnowledgeGraph:
    """Build a KnowledgeGraph from extracted entities and relations."""
    graph = KnowledgeGraph()
    entity_map: Dict[str, str] = {}  # normalized text -> node_id

    for entity in entities:
        graph.add_node(
            node_id=entity.unique_id,
            label=entity.text,
            entity_type=entity.entity_type,
            doc_id=entity.doc_id,
        )
        entity_map[_normalize(entity.text)] = entity.unique_id

    for rel in relations:
        src_id = entity_map.get(_normalize(rel.subject))
        tgt_id = entity_map.get(_normalize(rel.obj))
        if src_id and tgt_id and src_id != tgt_id:
            graph.add_edge(
                source=src_id,
                target=tgt_id,
                relation_type=rel.predicate,
                doc_id=entities[0].doc_id if entities else 0,
                bidirectional=rel.bidirectional,
            )

    return graph
