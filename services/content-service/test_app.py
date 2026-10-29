"""Kiem thu phan logic, KHONG goi Internet: python -m unittest test_app.py"""
import asyncio
import unittest

import app


class FakeBackend:
    """Gia lap Google Translate: them tien to [target], dem so lan goi."""

    def __init__(self, break_lines=False):
        self.calls = 0
        self.break_lines = break_lines

    def __call__(self, text, source, target):
        self.calls += 1
        out = "\n".join(f"[{target}] {line}" for line in text.split("\n"))
        return out.replace("\n", " ") if self.break_lines and "\n" in text else out


class TestPure(unittest.TestCase):
    def test_clean(self):
        self.assertEqual(app.clean("  a\n b\t\tc  "), "a b c")

    def test_batches_respect_limit(self):
        texts = ["x" * 30, "y" * 30, "z" * 30, "w" * 100]
        b = app.make_batches(texts, limit=70)
        self.assertEqual(b, [[0, 1], [2], [3]])

    def test_pick_voice(self):
        self.assertEqual(app.pick_voice("zh-CN", None), "zh-CN-XiaoxiaoNeural")
        self.assertEqual(app.pick_voice("en-GB", None), "en-US-JennyNeural")
        voices = [{"Locale": "it-IT", "ShortName": "it-IT-ElsaNeural"}]
        self.assertEqual(app.pick_voice("it", voices), "it-IT-ElsaNeural")
        self.assertEqual(app.pick_voice("xx", voices), app.FALLBACK_VOICE)


class TestTranslator(unittest.TestCase):
    def test_batch_cache_and_dedupe(self):
        be = FakeBackend()
        tr = app.Translator(backend=be)
        out = asyncio.run(tr.translate_many(["Xin chào", "Phở\nngon", "", "Xin chào"], "vi", "en"))
        self.assertEqual(out, ["[en] Xin chào", "[en] Phở ngon", "", "[en] Xin chào"])
        self.assertEqual(be.calls, 1)                     # 2 doan khac nhau -> 1 lo -> 1 lan goi
        asyncio.run(tr.translate_many(["Xin chào"], "vi", "en"))
        self.assertEqual(be.calls, 1)                     # lan 2 lay tu cache

    def test_line_mismatch_falls_back_to_single(self):
        be = FakeBackend(break_lines=True)
        tr = app.Translator(backend=be)
        out = asyncio.run(tr.translate_many(["a", "b", "c"], "vi", "ja"))
        self.assertEqual(out, ["[ja] a", "[ja] b", "[ja] c"])
        self.assertEqual(be.calls, 4)                     # 1 lo hong + 3 lan dich le

    def test_same_language_no_call(self):
        be = FakeBackend()
        out = asyncio.run(app.Translator(backend=be).translate_many(["Phở"], "vi", "vi"))
        self.assertEqual((out, be.calls), (["Phở"], 0))


if __name__ == "__main__":
    unittest.main()


class TestGoogleBackend(unittest.TestCase):
    def setUp(self):
        self.orig = (app.gtx_translate, app.deep_translate, app.time.sleep)
        app.time.sleep = lambda s: None

    def tearDown(self):
        app.gtx_translate, app.deep_translate, app.time.sleep = self.orig

    def test_parse_gtx(self):
        data = [[["Hello. ", "Xin chao. ", None], ["Good pho.", "Pho ngon.", None]], None, "vi"]
        self.assertEqual(app.parse_gtx(data), "Hello. Good pho.")

    def test_retry_after_429(self):
        calls = []
        def gtx(t, s, d):
            calls.append("gtx")
            if len(calls) == 1:
                raise app.RateLimited("429")
            return "ok"
        app.gtx_translate = gtx
        app.deep_translate = lambda *a: calls.append("deep") or "deep"
        self.assertEqual(app.google_translate("x", "vi", "en"), "ok")
        self.assertEqual(calls, ["gtx", "gtx"])          # bi 429 thi doi, khong goi ngay duong du phong

    def test_fallback_when_gtx_broken(self):
        def gtx(*a):
            raise ValueError("bad json")
        app.gtx_translate = gtx
        app.deep_translate = lambda *a: "deep"
        self.assertEqual(app.google_translate("x", "vi", "en"), "deep")

    def test_gives_up_after_retries(self):
        def boom(*a):
            raise app.RateLimited("429")
        app.gtx_translate = app.deep_translate = boom
        with self.assertRaises(app.RateLimited):
            app.google_translate("x", "vi", "en")
