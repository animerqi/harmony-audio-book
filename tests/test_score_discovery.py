import unittest

from scripts.score_discovery import SCORE_FOUND, SCORE_REFERENCE_ONLY, detect_score_candidates


class ScoreDiscoveryTests(unittest.TestCase):
    def test_unnumbered_score_after_previous_score_reference(self):
        html = """
        <p class="headline headline-level-2">9-6 和弦的伴奏音型</p>
        <p class="paragraph"><em>谱例9.80：</em>分解和弦</p>
        <p class="paragraph">如之前出现过的谱例：（https://www.bilibili.com/video/av18658796）</p>
        <p class="illus expandable H_C"><img data-seq="1355452594" data-orig-src="https://example.test/score.jpg" data-orig-width="611" data-orig-height="286"></p>
        """
        report = detect_score_candidates(html, "basic", "fixture.html")
        candidate = next(item for item in report["candidates"] if item.get("imageSeq") == "1355452594")
        self.assertEqual(candidate["status"], SCORE_FOUND)
        self.assertEqual(candidate["scoreId"], "9.80 图1")
        self.assertTrue(candidate["eligible"])

    def test_lazy_source_is_resolved(self):
        html = '<p class="paragraph">如下谱例</p><figure><img src="placeholder.gif" data-src="score.png" width="400" height="200"></figure>'
        report = detect_score_candidates(html, "basic", "fixture.html")
        candidate = next(item for item in report["candidates"] if item["status"] == SCORE_FOUND)
        self.assertEqual(candidate["resource"]["url"], "score.png")

    def test_reference_without_resource_is_not_invented(self):
        html = '<p class="paragraph">如之前出现过的谱例，下面继续讨论。</p>'
        report = detect_score_candidates(html, "basic", "fixture.html")
        self.assertEqual(report["summary"]["referenceOnly"], 1)
        self.assertEqual(report["candidates"][0]["status"], SCORE_REFERENCE_ONLY)

    def test_plain_illustration_is_not_a_score_candidate(self):
        html = '<p class="paragraph">这是作者照片。</p><p class="illus"><img src="portrait.jpg" width="600" height="800"></p>'
        report = detect_score_candidates(html, "basic", "fixture.html")
        self.assertEqual(report["summary"]["scoreCandidates"], 0)


if __name__ == "__main__":
    unittest.main()
