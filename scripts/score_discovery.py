"""DOM-aware discovery of score-image candidates in the book HTML.

This module deliberately stops at candidate discovery.  It does not run HOMR
and it never treats an external video URL as a score resource.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from html import unescape
from html.parser import HTMLParser
import hashlib
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


SCORE_FOUND = "SCORE_FOUND"
SCORE_REFERENCE_ONLY = "SCORE_REFERENCE_ONLY"
SCORE_MISSING = "SCORE_MISSING"
NON_SCORE_RESOURCE = "NON_SCORE_RESOURCE"

SCORE_KEYWORDS = (
    "谱例",
    "乐谱",
    "如下谱例",
    "下例",
    "如图",
    "见谱",
    "五线谱",
    "旋律如下",
    "和声如下",
    "之前出现过的谱例",
)
MUSIC_CONTEXT = re.compile(
    r"谱|乐谱|旋律|和声|和弦|小节|音符|钢琴|琶音|拍号|调号|五线谱|音型|节奏|声部"
)
SCORE_PHRASE = re.compile(r"谱例\s*([0-9]+(?:\.[0-9]+)+)")
REFERENCE_PHRASE = re.compile(r"(?:如之前出现过的|上节的|前面(?:提到|的)|上面的|上述|见上(?:谱|例)|见前(?:谱|例)).{0,12}谱例")
SECTION_HEADING = re.compile(r"^(\d+(?:-\d+)?)\s*(.*)$")
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".svg"}
RESOURCE_TAGS = {"img", "picture", "source", "figure", "svg", "a"}
BLOCK_TAGS = {"p", "div", "figure", "li", "section", "article", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"}


@dataclass
class DomNode:
    tag: str
    attrs: dict[str, str]
    parent: "DomNode | None" = None
    children: list["DomNode"] = field(default_factory=list)
    text_parts: list[str] = field(default_factory=list)
    contents: list["DomNode | str"] = field(default_factory=list)
    order: int = 0


class _BookParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = DomNode("#document", {})
        self.stack = [self.root]
        self.order = 0

    def _start(self, tag: str, attrs: list[tuple[str, str | None]], push: bool) -> None:
        node = DomNode(
            tag.lower(),
            {key.lower(): unescape(value or "") for key, value in attrs},
            parent=self.stack[-1],
            order=self.order,
        )
        self.order += 1
        self.stack[-1].children.append(node)
        self.stack[-1].contents.append(node)
        if push:
            self.stack.append(node)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._start(tag, attrs, tag.lower() not in {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"})

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._start(tag, attrs, False)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return

    def handle_data(self, data: str) -> None:
        if data:
            self.stack[-1].text_parts.append(data)
            self.stack[-1].contents.append(data)


def parse_html(source: str) -> DomNode:
    parser = _BookParser()
    parser.feed(source)
    parser.close()
    return parser.root


def node_text(node: DomNode) -> str:
    parts = [node_text(item) if isinstance(item, DomNode) else item for item in node.contents]
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def ancestors(node: DomNode) -> list[DomNode]:
    result: list[DomNode] = []
    current = node.parent
    while current is not None:
        result.append(current)
        current = current.parent
    return result


def block_for(node: DomNode) -> DomNode:
    current = node
    while current.parent is not None and current.tag not in BLOCK_TAGS:
        current = current.parent
    return current


def attr_number(attrs: dict[str, str], key: str) -> float | None:
    value = attrs.get(key)
    if not value:
        return None
    match = re.search(r"\d+(?:\.\d+)?", value)
    return float(match.group(0)) if match else None


def srcset_first(value: str | None) -> str | None:
    if not value:
        return None
    first = value.split(",", 1)[0].strip().split()
    return first[0] if first else None


def resolve_resource(node: DomNode) -> dict[str, Any] | None:
    chain = [node, *ancestors(node)]
    aliases: list[str] = []
    url: str | None = None
    source_attr: str | None = None
    for current in chain:
        attrs = current.attrs
        for key in ("data-orig-src", "data-src", "data-original", "data-lazy-src", "data-url", "src", "data-srcset", "srcset"):
            candidate = srcset_first(attrs.get(key)) if "srcset" in key else attrs.get(key)
            if candidate and candidate not in aliases:
                aliases.append(candidate)
            if not url and candidate and not candidate.startswith("data:image/svg+xml"):
                url = candidate
                source_attr = key
        style = attrs.get("style", "")
        background = re.search(r"background-image\s*:\s*url\(([^)]+)\)", style, re.IGNORECASE)
        if background:
            candidate = background.group(1).strip(" '\"")
            if candidate not in aliases:
                aliases.append(candidate)
            if not url:
                url = candidate
                source_attr = "background-image"
        if current.tag == "a" and attrs.get("href"):
            href = attrs["href"]
            if href not in aliases:
                aliases.append(href)
            if not url and Path(urlparse(href).path).suffix.lower() in IMAGE_EXTENSIONS:
                url = href
                source_attr = "href"
    if node.tag == "svg" and not url:
        return {
            "kind": "svg-inline",
            "url": None,
            "sourceAttr": "inline-svg",
            "aliases": [],
            "width": attr_number(node.attrs, "width"),
            "height": attr_number(node.attrs, "height"),
        }
    if not url:
        return None
    return {
        "kind": "image" if node.tag in {"img", "picture", "source"} else node.tag,
        "url": url,
        "sourceAttr": source_attr,
        "aliases": aliases,
        "width": attr_number(node.attrs, "width") or next((attr_number(parent.attrs, "data-orig-width") for parent in chain if attr_number(parent.attrs, "data-orig-width") is not None), None),
        "height": attr_number(node.attrs, "height") or next((attr_number(parent.attrs, "data-orig-height") for parent in chain if attr_number(parent.attrs, "data-orig-height") is not None), None),
    }


def class_context(node: DomNode) -> str:
    return " ".join(parent.attrs.get("class", "") for parent in [node, *ancestors(node)])


def image_sequence(node: DomNode, resource: dict[str, Any]) -> str:
    for current in [node, *ancestors(node)]:
        if current.attrs.get("data-seq"):
            return current.attrs["data-seq"]
    return hashlib.sha1((resource.get("url") or "inline-svg").encode("utf-8")).hexdigest()[:12]


def _resource_nodes(root: DomNode) -> list[DomNode]:
    found: list[DomNode] = []

    def visit(node: DomNode) -> None:
        if node.tag in RESOURCE_TAGS:
            if node.tag == "source" and any(child.tag == "img" for child in node.parent.children) if node.parent else False:
                return
            found.append(node)
        if "background-image" in node.attrs.get("style", ""):
            found.append(node)
        for child in node.children:
            visit(child)

    visit(root)
    return found


def _block_list(root: DomNode) -> list[DomNode]:
    nodes: list[DomNode] = []

    def visit(node: DomNode) -> None:
        if node.tag in BLOCK_TAGS:
            nodes.append(node)
        for child in node.children:
            visit(child)

    visit(root)
    return sorted(nodes, key=lambda node: node.order)


def _section_for(block: DomNode, current: str) -> str:
    if block.tag not in {"h1", "h2", "h3", "h4", "h5", "h6"} and "headline" not in block.attrs.get("class", ""):
        return current
    text = node_text(block)
    match = SECTION_HEADING.match(text)
    return match.group(1) if match else current


def _score_context(text: str) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    for keyword in SCORE_KEYWORDS:
        if keyword in text:
            reasons.append(f"keyword: {keyword}")
    return bool(reasons), reasons


def detect_score_candidates(source: str, volume: str, source_name: str = "") -> dict[str, Any]:
    """Return DOM-aware candidates and an audit summary for one HTML book."""

    root = parse_html(source)
    blocks = _block_list(root)
    block_index = {id(block): index for index, block in enumerate(blocks)}
    section = ""
    sections: dict[int, str] = {}
    for index, block in enumerate(blocks):
        section = _section_for(block, section)
        sections[index] = section

    resources: list[dict[str, Any]] = []
    for node in _resource_nodes(root):
        resource = resolve_resource(node)
        if not resource:
            continue
        block = block_for(node)
        index = block_index.get(id(block), 0)
        resources.append({"node": node, "resource": resource, "block": block, "index": index})

    found: list[dict[str, Any]] = []
    used_blocks: set[int] = set()
    for item in resources:
        index = item["index"]
        window = blocks[max(0, index - 3): min(len(blocks), index + 4)]
        nearby = " ".join(node_text(block) for block in window)
        block_text = node_text(item["block"])
        caption_matches = [
            (abs(window_index - index), SCORE_PHRASE.search(node_text(blocks[window_index])))
            for window_index in range(max(0, index - 1), min(len(blocks), index + 2))
            if SCORE_PHRASE.search(node_text(blocks[window_index]))
        ]
        reference_indexes = [window_index for window_index in range(max(0, index - 3), index + 1) if "如之前出现过的谱例" in node_text(blocks[window_index])]
        reference_before = bool(reference_indexes)
        caption_match = min(caption_matches, key=lambda item: item[0])[1] if caption_matches else None
        reference_caption: tuple[int, re.Match[str]] | None = None
        if reference_before:
            prior_captions = [
                (window_index, SCORE_PHRASE.search(node_text(blocks[window_index])))
                for window_index in range(max(0, index - 6), index + 1)
                if SCORE_PHRASE.search(node_text(blocks[window_index]))
            ]
            if prior_captions:
                reference_caption = (prior_captions[-1][0], prior_captions[-1][1])
        has_keyword, keyword_reasons = _score_context(nearby)
        strong_keyword_reasons = [reason for reason in keyword_reasons if not reason.startswith("keyword: 乐谱") and not reason.startswith("keyword: 五线谱") and not reason.startswith("keyword: 如图")]
        explicit_score_wording = any(reason in strong_keyword_reasons for reason in ("keyword: 如下谱例", "keyword: 下例", "keyword: 见谱", "keyword: 旋律如下", "keyword: 和声如下"))
        reasons = list(keyword_reasons)
        class_name = class_context(item["node"])
        if class_name:
            class_hits = [token for token in ("illus", "score", "music", "notation", "example", "M_C", "H_C") if token.lower() in class_name.lower()]
            if class_hits:
                reasons.append(f"class: {','.join(class_hits)}")
        if item["node"].tag in {"img", "picture", "figure", "svg"}:
            reasons.append(f"DOM resource: {item['node'].tag}")
        if MUSIC_CONTEXT.search(nearby):
            reasons.append("nearby music terminology")
        width = item["resource"].get("width")
        height = item["resource"].get("height")
        if width and height and 0.25 <= width / height <= 8:
            reasons.append("image dimensions available")
        supplemental_reference = bool(
            reference_caption
            and reference_indexes
            and reference_indexes[-1] > reference_caption[0]
            and not caption_match
        )
        confidence = 0.0
        confidence += 0.5 if caption_match else 0.0
        confidence += 0.3 if strong_keyword_reasons else (0.1 if has_keyword else 0.0)
        confidence += 0.15 if any(reason.startswith("class:") for reason in reasons) else 0.0
        confidence += 0.1 if item["node"].tag in {"img", "picture", "figure"} else 0.0
        confidence += 0.05 if MUSIC_CONTEXT.search(nearby) else 0.0
        confidence += 0.1 if supplemental_reference else 0.0
        confidence += 0.2 if explicit_score_wording else 0.0
        confidence = min(1.0, confidence)
        eligible = confidence >= 0.65 and item["resource"].get("url") is not None
        score_id = caption_match.group(1) if caption_match else None
        if supplemental_reference:
            score_id = f"{reference_caption[1].group(1)} 图1"
            reasons.append("unnumbered image after an earlier-score reference")
        if not score_id and "如之前出现过的谱例" in block_text:
            prior_caption = SCORE_PHRASE.search(" ".join(node_text(blocks[i]) for i in range(0, index)))
            score_id = f"{prior_caption.group(1)} 图1" if prior_caption else None
            reasons.append("semantic reference: 之前出现过的谱例")
        candidate = {
            "volume": volume,
            "source": source_name,
            "blockIndex": index,
            "chapter": sections.get(index, ""),
            "scoreId": score_id,
            "imageSeq": image_sequence(item["node"], item["resource"]),
            "nearbyText": nearby[:500],
            "resource": item["resource"],
            "confidence": round(confidence, 3),
            "eligible": eligible,
            "status": SCORE_FOUND if eligible else NON_SCORE_RESOURCE,
            "reasons": reasons,
        }
        found.append(candidate)
        used_blocks.add(index)

    references: list[dict[str, Any]] = []
    for index, block in enumerate(blocks):
        text = node_text(block)
        has_keyword, reasons = _score_context(text)
        if not has_keyword or index in used_blocks:
            continue
        window_indexes = range(max(0, index - 3), min(len(blocks), index + 4))
        nearby_resource = any(item["index"] in window_indexes and item["resource"].get("url") for item in resources)
        if nearby_resource:
            continue
        if REFERENCE_PHRASE.search(text):
            status = SCORE_REFERENCE_ONLY
            reasons.append("no nearby resource; wording refers to an earlier score")
        elif re.search(r"如下谱例|下例|见谱|谱例\s*[0-9]", text):
            status = SCORE_MISSING
            reasons.append("score wording without a nearby image resource")
        else:
            continue
        references.append({
            "volume": volume,
            "source": source_name,
            "blockIndex": index,
            "chapter": sections.get(index, ""),
            "scoreId": (SCORE_PHRASE.search(text).group(1) if SCORE_PHRASE.search(text) else None),
            "imageSeq": None,
            "nearbyText": text[:500],
            "resource": None,
            "confidence": round(0.55 if status == SCORE_REFERENCE_ONLY else 0.65, 3),
            "eligible": False,
            "status": status,
            "reasons": reasons,
        })

    all_candidates = found + references
    summary = {
        "htmlBlocks": len(blocks),
        "htmlImages": sum(1 for item in resources if item["node"].tag == "img"),
        "resourceNodes": len(resources),
        "scoreCandidates": sum(1 for item in found if item["eligible"]),
        "scoreFound": sum(1 for item in all_candidates if item["status"] == SCORE_FOUND),
        "referenceOnly": sum(1 for item in all_candidates if item["status"] == SCORE_REFERENCE_ONLY),
        "scoreMissing": sum(1 for item in all_candidates if item["status"] == SCORE_MISSING),
        "lowConfidenceResources": sum(1 for item in found if item["status"] == NON_SCORE_RESOURCE),
    }
    return {"volume": volume, "source": source_name, "summary": summary, "candidates": all_candidates}


def write_discovery_report(
    reports: list[dict[str, Any]],
    output: Path,
    manifest: set[str] | None = None,
    index_keys: set[str] | None = None,
    processed_keys: set[str] | None = None,
) -> dict[str, Any]:
    manifest = manifest or set()
    index_keys = index_keys or set()
    processed_keys = processed_keys or set()
    enriched: list[dict[str, Any]] = []
    for report in reports:
        for candidate in report["candidates"]:
            if candidate.get("status") == NON_SCORE_RESOURCE:
                continue
            candidate = dict(candidate)
            key = candidate.get("imageSeq")
            candidate["indexed"] = bool(key and key in index_keys)
            candidate["homrProcessed"] = bool(key and key in processed_keys)
            candidate["manifestEntry"] = bool(key and key in manifest)
            enriched.append(candidate)
    summary = {
        "htmlImages": sum(report["summary"]["htmlImages"] for report in reports),
        "scoreCandidates": sum(report["summary"]["scoreCandidates"] for report in reports),
        "scoreFound": sum(report["summary"]["scoreFound"] for report in reports),
        "referenceOnly": sum(report["summary"]["referenceOnly"] for report in reports),
        "scoreMissing": sum(report["summary"]["scoreMissing"] for report in reports),
        "lowConfidenceResources": sum(report["summary"]["lowConfidenceResources"] for report in reports),
        "indexedCandidates": sum(1 for item in enriched if item["indexed"]),
        "homrProcessed": sum(1 for item in enriched if item["homrProcessed"]),
        "manifestEntries": sum(1 for item in enriched if item["manifestEntry"]),
    }
    payload = {"summary": summary, "books": reports, "candidates": enriched}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload
