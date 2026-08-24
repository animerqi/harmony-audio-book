"""Export HOMR MusicXML results as browser-playable note events.

The original .musicxml and .mid files remain the source artifacts. This script
only creates a small JSON manifest so the web demo can synthesize the MIDI notes
without relying on native browser MIDI playback.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from music21 import chord, converter, note, tempo


def score_events(xml_path: Path) -> tuple[list[dict[str, object]], int]:
    score = converter.parse(xml_path)
    marks = list(score.recurse().getElementsByClass(tempo.MetronomeMark))
    bpm = round(marks[0].number) if marks and marks[0].number else 88
    events: list[dict[str, object]] = []

    for element in score.flatten().notes:
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

    return events, bpm


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("output_file", type=Path)
    args = parser.parse_args()

    items = []
    for xml_path in sorted(args.input_dir.glob("score-*.musicxml")):
        score_id = xml_path.stem.removeprefix("score-")
        events, bpm = score_events(xml_path)
        items.append(
            {
                "id": score_id,
                "bpm": bpm,
                "eventCount": len(events),
                "events": events,
                "midiUrl": f"/score-audio/score-{score_id}.mid",
                "musicXmlUrl": f"/score-audio/score-{score_id}.musicxml",
                "engine": "HOMR GUI / HOMR",
            }
        )

    args.output_file.parent.mkdir(parents=True, exist_ok=True)
    args.output_file.write_text(
        json.dumps({"scores": items}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
