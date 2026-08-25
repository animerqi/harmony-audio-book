"""Download score figures, run HOMR, and build the browser audio manifest.

The script is resumable: existing downloads, MusicXML files, and exported MIDI
files are reused. HOMR failures are recorded so non-staff illustrations do not
block the rest of the book.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from music21 import chord, converter, note, tempo

try:
    from .score_discovery import SCORE_FOUND, detect_score_candidates
except ImportError:  # pragma: no cover - direct script execution
    from score_discovery import SCORE_FOUND, detect_score_candidates


PROJECT = Path(__file__).resolve().parents[1]
WORK = PROJECT / "work" / "full-omr"
IMAGES = WORK / "images"
LOGS = WORK / "logs"
INDEX = WORK / "score-index.json"
FAILURES = WORK / "score-failures.json"
PUBLIC_BOOKS = PROJECT / "public" / "books"
PUBLIC_IMAGES = PROJECT / "public" / "book-images" / "scores"
PUBLIC_AUDIO = PROJECT / "public" / "score-audio"
HOMR_REPO = PROJECT.parent / "homr_gui"
PREBUILT_SEQS = {"2.1": "938012151", "2.2": "938012698", "2.3": "938012775"}
MIN_UNNUMBERED_EVENTS = 5

SOURCES = {
    "basic": Path(r"E:\Downloads\图解和声(基础篇).html"),
    "advanced": Path(r"E:\Downloads\图解和声(高级篇).html"),
}

SCORE_GROUP = re.compile(
    r'<p\b[^>]*>(?P<caption>(?:(?!</p>).)*?谱例\s*'
    r'(?P<score_id>[0-9]+(?:\.[0-9]+)+)(?:(?!</p>).)*?)</p>\s*'
    r'(?P<figures>(?:<p\b[^>]*class="[^"]*illus[^"]*"[^>]*>.*?</p>\s*)+)',
    re.IGNORECASE | re.DOTALL,
)
IMAGE_TAG = re.compile(r"<img\b[^>]*>", re.IGNORECASE | re.DOTALL)


def attr(markup: str, name: str) -> str | None:
    match = re.search(rf'(?:^|\s){re.escape(name)}="([^"]+)"', markup, re.IGNORECASE)
    return html.unescape(match.group(1)) if match else None


def plain_text(markup: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", markup))).strip()


def safe_key(volume: str, score_id: str, image_seq: str) -> str:
    clean_id = re.sub(r"[^0-9A-Za-z]+", "-", score_id).strip("-")
    return f"{volume}-{clean_id}-{image_seq}"


def discover_scores() -> list[dict[str, str]]:
    specs: list[dict[str, str]] = []
    seen_images: set[str] = set()
    for volume, source_path in SOURCES.items():
        source = source_path.read_text(encoding="utf-8")
        rewritten = source

        def register_score(score_id: str, caption: str, image_markup: str) -> None:
            nonlocal rewritten
            url = attr(image_markup, "data-orig-src") or attr(image_markup, "src") or attr(image_markup, "data-src")
            if not url:
                return
            image_seq = attr(image_markup, "data-seq") or hashlib.sha1(url.encode()).hexdigest()[:12]
            if image_seq in seen_images:
                return
            seen_images.add(image_seq)
            key = safe_key(volume, score_id, image_seq)
            filename = f"score-{key}.jpg"
            specs.append(
                {
                    "volume": volume,
                    "scoreId": score_id,
                    "imageSeq": image_seq,
                    "key": key,
                    "caption": caption,
                    "url": url,
                    "filename": filename,
                }
            )
            for display_url in {
                attr(image_markup, "data-orig-src"),
                attr(image_markup, "data-src"),
                attr(image_markup, "src"),
            } - {None}:
                rewritten = rewritten.replace(display_url, f"/book-images/scores/{filename}")

        def register_candidate(candidate: dict[str, object]) -> None:
            nonlocal rewritten
            resource = candidate.get("resource")
            if not isinstance(resource, dict):
                return
            url = resource.get("url")
            image_seq = candidate.get("imageSeq")
            score_id = candidate.get("scoreId") or f"{candidate.get('chapter') or volume} 图1"
            if not isinstance(url, str) or not url or not isinstance(image_seq, str) or not isinstance(score_id, str):
                return
            if image_seq in seen_images:
                return
            seen_images.add(image_seq)
            key = safe_key(volume, score_id, image_seq)
            filename = f"score-{key}.jpg"
            specs.append(
                {
                    "volume": volume,
                    "scoreId": score_id,
                    "imageSeq": image_seq,
                    "key": key,
                    "caption": str(candidate.get("nearbyText") or ""),
                    "url": url,
                    "filename": filename,
                }
            )
            for display_url in set(resource.get("aliases") or []) - {None}:
                rewritten = rewritten.replace(str(display_url), f"/book-images/scores/{filename}")

        for match in SCORE_GROUP.finditer(source):
            for image_match in IMAGE_TAG.finditer(match.group("figures")):
                register_score(match.group("score_id"), plain_text(match.group("caption")), image_match.group(0))

        pending_id: str | None = None
        pending_caption = ""
        patience = 0
        found_image = False
        for line in source.splitlines():
            line_text = plain_text(line)
            caption_match = re.match(r"^谱例\s*([0-9]+(?:\.[0-9]+)+)", line_text)
            if caption_match:
                pending_id = caption_match.group(1)
                pending_caption = plain_text(line)
                patience = 3
                found_image = False
                continue
            if not pending_id:
                continue
            images = list(IMAGE_TAG.finditer(line))
            if images:
                if pending_id:
                    for image_match in images:
                        register_score(pending_id, pending_caption, image_match.group(0))
                found_image = True
                continue
            if not pending_id:
                continue
            if found_image:
                pending_id = None
            elif line.strip():
                patience -= 1
                if patience <= 0 or "headline-level" in line or line.lstrip().startswith("<h1"):
                    pending_id = None

        # The advanced volume frequently presents several score excerpts under
        # one prose introduction without repeating a numbered "谱例" caption.
        # Register every still-unseen image in each advanced section and let
        # HOMR's staff detector decide whether it is actually playable notation.
        # The section-local image number is descriptive only; it does not invent
        # a book score ID.  This also catches continuation images belonging to a
        # numbered example, such as the later pages of 谱例 11.64.
        if volume == "advanced":
            current_section = ""
            section_image_index: dict[str, int] = {}
            for line in source.splitlines():
                if re.search(r"<h1\b", line, re.IGNORECASE):
                    heading_match = re.match(r"^(\d+-\d+)\b", plain_text(line))
                    current_section = heading_match.group(1) if heading_match else ""
                if not current_section:
                    continue
                for image_match in IMAGE_TAG.finditer(line):
                    section_image_index[current_section] = section_image_index.get(current_section, 0) + 1
                    image_seq = attr(image_match.group(0), "data-seq")
                    if image_seq and image_seq in seen_images:
                        continue
                    image_number = section_image_index[current_section]
                    register_score(
                        f"{current_section} 图{image_number}",
                        f"{current_section} 未编号谱图（本节第{image_number}张）",
                        image_match.group(0),
                    )
        detected = detect_score_candidates(source, volume, str(source_path))
        for candidate in detected["candidates"]:
            if candidate.get("status") == SCORE_FOUND and candidate.get("eligible"):
                register_candidate(candidate)
        (PUBLIC_BOOKS / f"{volume}.html").write_text(rewritten, encoding="utf-8")
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(json.dumps(specs, ensure_ascii=False, indent=2), encoding="utf-8")
    return specs


def download_one(spec: dict[str, str]) -> tuple[str, bool, str]:
    target = IMAGES / spec["filename"]
    public_target = PUBLIC_IMAGES / spec["filename"]
    if target.exists() and target.stat().st_size > 500:
        if not public_target.exists():
            shutil.copy2(target, public_target)
        return spec["key"], True, "cached"
    try:
        response = requests.get(
            spec["url"],
            timeout=45,
            headers={"User-Agent": "Mozilla/5.0 HarmonyReader/1.0"},
        )
        response.raise_for_status()
        target.write_bytes(response.content)
        shutil.copy2(target, public_target)
        return spec["key"], True, f"{len(response.content)} bytes"
    except Exception as exc:  # noqa: BLE001 - every image should be attempted
        return spec["key"], False, str(exc)


def prepare(download_workers: int) -> list[dict[str, str]]:
    IMAGES.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    PUBLIC_IMAGES.mkdir(parents=True, exist_ok=True)
    PUBLIC_AUDIO.mkdir(parents=True, exist_ok=True)
    specs = discover_scores()
    failures: list[dict[str, str]] = []
    completed = 0
    with ThreadPoolExecutor(max_workers=download_workers) as pool:
        futures = {pool.submit(download_one, spec): spec for spec in specs}
        for future in as_completed(futures):
            key, ok, detail = future.result()
            completed += 1
            if not ok:
                failures.append({"key": key, "stage": "download", "error": detail})
            if completed % 25 == 0 or completed == len(specs):
                print(f"downloaded {completed}/{len(specs)}; failures={len(failures)}", flush=True)
    FAILURES.write_text(json.dumps(failures, ensure_ascii=False, indent=2), encoding="utf-8")
    return specs


def run_homr(spec: dict[str, str]) -> tuple[str, bool, float, str]:
    image_path = IMAGES / spec["filename"]
    xml_path = image_path.with_suffix(".musicxml")
    if PREBUILT_SEQS.get(spec["scoreId"]) == spec["imageSeq"] and spec["volume"] == "basic":
        return spec["key"], True, 0.0, "prebuilt"
    if xml_path.exists() and xml_path.stat().st_size > 200:
        return spec["key"], True, 0.0, "cached"
    if not image_path.exists():
        return spec["key"], False, 0.0, "image missing"
    started = time.perf_counter()
    log_path = LOGS / f"{spec['key']}.log"
    command = [
        sys.executable,
        "-m",
        "homr.main",
        str(image_path),
        "--output-tempo",
        "88",
    ]
    try:
        with log_path.open("w", encoding="utf-8") as log:
            result = subprocess.run(
                command,
                cwd=HOMR_REPO,
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=900,
                check=False,
            )
        ok = result.returncode == 0 and xml_path.exists() and xml_path.stat().st_size > 200
        return spec["key"], ok, time.perf_counter() - started, f"exit={result.returncode}"
    except Exception as exc:  # noqa: BLE001 - record and continue the full batch
        return spec["key"], False, time.perf_counter() - started, str(exc)


def score_events(xml_path: Path) -> tuple[list[dict[str, object]], int, object]:
    parsed = converter.parse(xml_path)
    marks = list(parsed.recurse().getElementsByClass(tempo.MetronomeMark))
    bpm = round(marks[0].number) if marks and marks[0].number else 88
    events: list[dict[str, object]] = []
    for element in parsed.flatten().notes:
        pitches: list[int]
        if isinstance(element, note.Note):
            pitches = [element.pitch.midi]
        elif isinstance(element, chord.Chord):
            pitches = [pitch.midi for pitch in element.pitches]
        else:
            continue
        events.append(
            {
                "at": round(float(element.offset), 4),
                "duration": round(float(element.quarterLength), 4),
                "notes": pitches,
            }
        )
    return events, bpm, parsed


def load_prebuilt() -> dict[str, dict[str, object]]:
    manifest_path = PUBLIC_AUDIO / "manifest.json"
    if not manifest_path.exists():
        return {}
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    return {
        str(item["id"]): item
        for item in data.get("scores", [])
        if item.get("id") in {"2.1", "2.2", "2.3"}
    }


def export_manifest(specs: list[dict[str, str]]) -> tuple[int, list[dict[str, str]]]:
    prebuilt = load_prebuilt()
    items: list[dict[str, object]] = []
    export_failures: list[dict[str, str]] = []
    for spec in specs:
        if PREBUILT_SEQS.get(spec["scoreId"]) == spec["imageSeq"] and spec["volume"] == "basic":
            item = dict(prebuilt[spec["scoreId"]])
            item.update({"key": spec["key"], "imageSeq": spec["imageSeq"]})
            items.append(item)
            continue
        xml_path = (IMAGES / spec["filename"]).with_suffix(".musicxml")
        if not xml_path.exists():
            continue
        public_xml = PUBLIC_AUDIO / f"score-{spec['key']}.musicxml"
        public_midi = PUBLIC_AUDIO / f"score-{spec['key']}.mid"
        try:
            events, bpm, parsed = score_events(xml_path)
            if not events:
                raise ValueError("MusicXML contains no notes")
            # A few theory diagrams contain a tiny decorative staff (for
            # example a circle-of-fifths chart).  HOMR can technically extract
            # one or two notes from them, but that is not a useful score
            # example.  Keep short numbered examples intact while filtering
            # only the automatically discovered, unnumbered image candidates.
            if " 图" in spec["scoreId"] and len(events) < MIN_UNNUMBERED_EVENTS:
                continue
            shutil.copy2(xml_path, public_xml)
            if not public_midi.exists():
                parsed.write("midi", fp=str(public_midi))
            items.append(
                {
                    "id": spec["scoreId"],
                    "key": spec["key"],
                    "imageSeq": spec["imageSeq"],
                    "bpm": bpm,
                    "eventCount": len(events),
                    "events": events,
                    "midiUrl": f"/score-audio/{public_midi.name}",
                    "musicXmlUrl": f"/score-audio/{public_xml.name}",
                    "engine": "HOMR GUI / HOMR",
                }
            )
        except Exception as exc:  # noqa: BLE001 - malformed OMR output should not block others
            export_failures.append({"key": spec["key"], "stage": "export", "error": str(exc)})
    (PUBLIC_AUDIO / "manifest.json").write_text(
        json.dumps({"scores": items}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    return len(items), export_failures


def process(workers: int, chapter: str | None = None) -> None:
    if not INDEX.exists():
        raise SystemExit("Run with --prepare first")
    specs: list[dict[str, str]] = json.loads(INDEX.read_text(encoding="utf-8"))
    process_specs = specs
    if chapter:
        normalized = chapter.strip().removesuffix(".")
        process_specs = [
            spec
            for spec in specs
            if spec.get("volume") == "basic"
            and str(spec.get("scoreId", "")).startswith(f"{normalized}.")
        ]
        if not process_specs:
            raise SystemExit(f"No basic-book score candidates found for chapter {chapter}")
        print(f"processing chapter {normalized}: {len(process_specs)} candidate(s)", flush=True)
    prior_failures = json.loads(FAILURES.read_text(encoding="utf-8")) if FAILURES.exists() else []
    failures: list[dict[str, str]] = list(prior_failures)
    completed = 0
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(run_homr, spec): spec for spec in process_specs}
        for future in as_completed(futures):
            key, ok, elapsed, detail = future.result()
            completed += 1
            if not ok:
                failures.append({"key": key, "stage": "homr", "error": detail})
            print(
                f"omr {completed}/{len(process_specs)} {'ok' if ok else 'skip'} "
                f"{key} {elapsed:.1f}s; failures={len(failures)}",
                flush=True,
            )
    exported, export_failures = export_manifest(specs)
    failures.extend(export_failures)
    FAILURES.write_text(json.dumps(failures, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"complete: exported={exported}, failures={len(failures)}, "
        f"elapsed={(time.perf_counter() - started) / 60:.1f} min",
        flush=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--process", action="store_true")
    parser.add_argument("--export", action="store_true")
    parser.add_argument("--download-workers", type=int, default=12)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument(
        "--chapter",
        help="When processing, run HOMR only for a basic-book chapter (for example: 9).",
    )
    args = parser.parse_args()
    if not args.prepare and not args.process and not args.export:
        parser.error("Choose --prepare, --process, and/or --export")
    if args.prepare:
        prepare(args.download_workers)
    if args.process:
        process(args.workers, args.chapter)
    elif args.export:
        if not INDEX.exists():
            raise SystemExit("Run with --prepare first")
        specs: list[dict[str, str]] = json.loads(INDEX.read_text(encoding="utf-8"))
        exported, export_failures = export_manifest(specs)
        print(f"complete: exported={exported}, export_failures={len(export_failures)}", flush=True)


if __name__ == "__main__":
    main()
