"""Audit harmony progression candidates in the book HTML.

This is intentionally dependency-free so it can run during content review and
in CI. It keeps the HTML emphasis context instead of reducing the book to one
large textContent string.
"""

from __future__ import annotations

import html
import json
import re
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BOOKS = {
    "基础篇": ROOT / "public" / "books" / "basic.html",
    "高级篇": ROOT / "public" / "books" / "advanced.html",
}


def clean(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    value = html.unescape(value)
    value = value.replace("♯", "#").replace("♭", "b").replace("–", "—")
    value = re.sub(r"\s+", " ", value).strip()
    return value


class ParagraphParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_paragraph = False
        self.depth = 0
        self.parts: list[str] = []
        self.emphasis: list[str] = []
        self.current_emphasis: list[str] | None = None
        self.rows: list[dict[str, object]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "p" and not self.in_paragraph:
            self.in_paragraph = True
            self.depth = 1
            self.parts = []
            self.emphasis = []
            self.current_emphasis = None
        elif self.in_paragraph:
            self.depth += 1
            if tag in {"i", "em", "strong", "b"} and self.current_emphasis is None:
                self.current_emphasis = []

    def handle_endtag(self, tag: str) -> None:
        if not self.in_paragraph:
            return
        if tag in {"i", "em", "strong", "b"} and self.current_emphasis is not None:
            value = clean("".join(self.current_emphasis))
            if value:
                self.emphasis.append(value)
            self.current_emphasis = None
        if tag == "p":
            text = clean("".join(self.parts))
            if text:
                self.rows.append({"text": text, "emphasis": self.emphasis[:]})
            self.in_paragraph = False
            self.depth = 0
            self.parts = []
            self.emphasis = []
            self.current_emphasis = None
        else:
            self.depth = max(0, self.depth - 1)

    def handle_data(self, data: str) -> None:
        if self.in_paragraph:
            self.parts.append(data)
            if self.current_emphasis is not None:
                self.current_emphasis.append(data)


# Permissive candidate patterns. The report is reviewed before candidates are
# promoted to playable content.
ABSOLUTE = re.compile(
    r"(?<![A-Za-z])(?:[A-G](?:#|b)?(?:maj(?:7|9)?|min(?:7)?|m(?:7|9)?|m7b5|dim7?|°7?|ø7?|aug7?|\+7?|7|Δ)?(?:/[A-G](?:#|b)?)?)"
    r"(?:\s*(?:—|–|-|→)\s*(?:[A-G](?:#|b)?(?:maj(?:7|9)?|min(?:7)?|m(?:7|9)?|m7b5|dim7?|°7?|ø7?|aug7?|\+7?|7|Δ)?(?:/[A-G](?:#|b)?)?)){1,12}"
)
ROMAN_TOKEN = r"(?:[#b]?\s*(?:(?:Ger|Gr|Fr|It)\+6|N6|k46|[#b]?(?:vii|VII|vi|VI|v|V|iv|IV|iii|III|ii|II|i|I)(?:[#b]?\d{0,2}|(?:°|ø|\+)?(?:\(?\d{1,2}\)?|Δ)?)(?:/[#b]?(?:vii|VII|vi|VI|v|V|iv|IV|iii|III|ii|II|i|I))?))"
ROMAN = re.compile(rf"(?<![A-Za-z]){ROMAN_TOKEN}(?:\s*(?:—|–|-|→|至|到)\s*{ROMAN_TOKEN}){{1,12}}")
DIGITS = re.compile(r"(?<!\d)(?:[1-7](?:\s*[-—]\s*[b#♭♯]?[1-7]){2,12})(?!\d)|(?<!\d)[1-7]{3,12}(?!\d)")
KEY = re.compile(r"(?P<tonic>[A-Ga-g](?:#|b|♯|♭)?)\s*(?P<mode>大调|小调|major|minor|maj|moll)")


def candidates(text: str, emphasis: list[str]) -> list[dict[str, object]]:
    output: list[dict[str, object]] = []
    seen: set[tuple[str, str]] = set()
    for source, value in [("emphasis", item) for item in emphasis] + [("paragraph", text)]:
        for kind, pattern in (("absolute", ABSOLUTE), ("roman", ROMAN), ("digits", DIGITS)):
            for match in pattern.finditer(value):
                notation = clean(match.group(0))
                key = (kind, notation)
                if key in seen:
                    continue
                seen.add(key)
                output.append({"kind": kind, "notation": notation, "source": source})
    return output


def main() -> None:
    report: dict[str, object] = {"books": {}, "totals": {"paragraphs": 0, "candidateParagraphs": 0, "candidates": 0}}
    for volume, path in BOOKS.items():
        parser = ParagraphParser()
        parser.feed(path.read_text(encoding="utf-8", errors="ignore"))
        rows = []
        counts: dict[str, int] = {"absolute": 0, "roman": 0, "digits": 0}
        for index, row in enumerate(parser.rows):
            text = str(row["text"])
            emphasis = list(row["emphasis"])  # type: ignore[arg-type]
            found = candidates(text, emphasis)
            if not found:
                continue
            context = KEY.search(text)
            for item in found:
                counts[str(item["kind"])] += 1
                item["paragraph"] = index
                item["keyContext"] = context.group(0) if context else None
                item["text"] = text[:500]
            rows.extend(found)
        report["books"][volume] = {
            "file": str(path),
            "paragraphs": len(parser.rows),
            "candidateCount": len(rows),
            "counts": counts,
            "candidates": rows,
        }
        report["totals"]["paragraphs"] = int(report["totals"]["paragraphs"]) + len(parser.rows)
        report["totals"]["candidateParagraphs"] = int(report["totals"]["candidateParagraphs"]) + len({int(row["paragraph"]) for row in rows})
        report["totals"]["candidates"] = int(report["totals"]["candidates"]) + len(rows)
    output = ROOT / "harmony-audit.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output), "totals": report["totals"], "books": {k: v["counts"] for k, v in report["books"].items()}}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
