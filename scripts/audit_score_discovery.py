"""Run the DOM-aware score discovery audit for both book volumes."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from score_discovery import detect_score_candidates, write_discovery_report


PROJECT = Path(__file__).resolve().parents[1]
SOURCES = {
    "basic": Path(r"E:\Downloads\图解和声(基础篇).html"),
    "advanced": Path(r"E:\Downloads\图解和声(高级篇).html"),
}
MANIFEST = PROJECT / "public" / "score-audio" / "manifest.json"
INDEX = PROJECT / "work" / "full-omr" / "score-index.json"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=PROJECT / "work" / "full-omr" / "score-discovery-report.json")
    args = parser.parse_args()

    reports = []
    for volume, path in SOURCES.items():
        if not path.exists():
            raise SystemExit(f"Missing source HTML: {path}")
        reports.append(detect_score_candidates(path.read_text(encoding="utf-8"), volume, str(path)))

    manifest_data = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {"scores": []}
    manifest_seqs = {str(item.get("imageSeq")) for item in manifest_data.get("scores", []) if item.get("imageSeq")}
    index_data = json.loads(INDEX.read_text(encoding="utf-8")) if INDEX.exists() else []
    index_seqs = {str(item.get("imageSeq")) for item in index_data if item.get("imageSeq")}
    processed_seqs = set(manifest_seqs)
    for item in index_data:
        image_seq = str(item.get("imageSeq")) if item.get("imageSeq") else ""
        filename = item.get("filename")
        if image_seq and filename and (PROJECT / "work" / "full-omr" / "images" / str(filename)).with_suffix(".musicxml").exists():
            processed_seqs.add(image_seq)
    payload = write_discovery_report(reports, args.output, manifest_seqs, index_seqs, processed_seqs)
    summary = payload["summary"]
    summary.update({
        "existingIndexEntries": len(index_seqs),
        "existingManifestEntries": len(manifest_seqs),
        "newFoundNotInManifest": sum(1 for item in payload["candidates"] if item["status"] == "SCORE_FOUND" and not item["manifestEntry"]),
        "unresolvedReferences": sum(1 for item in payload["candidates"] if item["status"] == "SCORE_REFERENCE_ONLY" and not item.get("scoreId")),
    })
    payload["summary"] = summary
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
