"""
Content Service: dich tu dong va doc thanh audio THEO YEU CAU (khong luu ban dich vao CSDL).

Thay cho content-worker cu (hang doi content_jobs + bang poi_translations):
- POST /translate  {"texts": [...], "target": "en", "source": "vi"}  -> {"texts": [...]}
- POST /tts        {"text": "...", "lang": "en"}                      -> file audio/mpeg
- GET  /health

Chi poi-service goi service nay (mang noi bo Docker, khong mo cong ra ngoai).
Dich: deep-translator (Google Translate, mien phi, khong can API key). Doc: Edge-TTS (mien phi).
Ca hai CAN Internet.

Cache (de nhanh, KHONG phai du lieu chinh):
- Ban dich: trong RAM (mat khi khoi dong lai service, lan sau dich lai).
- Audio: file mp3 trong CACHE_DIR, ten = MD5(giong|van ban). Van ban khong doi thi khong goi TTS lai.
"""
import asyncio
import hashlib
import json
import os
import re
import time
from collections import OrderedDict
from pathlib import Path

PORT = int(os.getenv("PORT", "4005"))
CACHE_DIR = Path(os.getenv("CACHE_DIR", "/tmp/tts-cache"))
CACHE_DAYS = int(os.getenv("CACHE_DAYS", "7"))           # xoa file audio cu hon so ngay nay khi khoi dong
# Goi Google tuan tu, nghi giua cac lan: goi don dap se bi Google tra 429 (TooManyRequests) va chan IP mot luc
TRANSLATE_CONCURRENCY = int(os.getenv("TRANSLATE_CONCURRENCY", "1"))
TRANSLATE_GAP_SEC = float(os.getenv("TRANSLATE_GAP_SEC", "0.4"))
TRANSLATE_CHUNK = 3000        # ky tu moi lo khi goi API gtx bang POST (van ban nam trong body, khong lo URL qua dai)
FALLBACK_CHUNK = 800          # deep-translator dat van ban len URL (GET): tieng Viet co dau ma hoa dai gap nhieu lan
GTX_URL = "https://translate.googleapis.com/translate_a/single"
RETRY_WAITS = (2, 6)          # gap 429 / loi mang: thu lai sau 2s roi 6s
MAX_TTS_CHARS = 5000
MAX_TEXTS = 2000
LANG_RE = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$")

# Giong mac dinh cho cac ngon ngu hay dung. Ngon ngu khac: tu tim trong danh sach giong cua Edge-TTS.
DEFAULT_VOICES = {
    "vi": "vi-VN-HoaiMyNeural",
    "en": "en-US-JennyNeural",
    "zh-cn": "zh-CN-XiaoxiaoNeural",
    "zh-tw": "zh-TW-HsiaoChenNeural",
    "ja": "ja-JP-NanamiNeural",
    "ko": "ko-KR-SunHiNeural",
    "fr": "fr-FR-DeniseNeural",
    "de": "de-DE-KatjaNeural",
    "es": "es-ES-ElviraNeural",
    "ru": "ru-RU-SvetlanaNeural",
    "th": "th-TH-PremwadeeNeural",
}
FALLBACK_VOICE = "en-US-JennyNeural"


def log(msg: str) -> None:
    print(f"[content-service] {msg}", flush=True)


# ---------------------------------------------------------------------------
# Ham thuan (khong goi mang) - de kiem thu
# ---------------------------------------------------------------------------
def clean(text: str) -> str:
    """Gop moi khoang trang/xuong dong thanh 1 dau cach: xuong dong duoc dung lam dau phan cach khi dich theo lo."""
    return re.sub(r"\s+", " ", text or "").strip()


def split_text(text: str, limit: int = TRANSLATE_CHUNK) -> list[str]:
    """Cat van ban dai theo cau, moi doan khong qua `limit` ky tu."""
    parts = re.findall(r"[^.!?]+[.!?]?\s*", text) or [text]
    out, cur = [], ""
    for p in parts:
        if cur and len(cur) + len(p) > limit:
            out.append(cur)
            cur = p
        else:
            cur += p
    if cur.strip():
        out.append(cur)
    return [x.strip() for x in out if x.strip()]


def make_batches(texts: list[str], limit: int = TRANSLATE_CHUNK) -> list[list[int]]:
    """Gom chi so cac van ban ngan thanh lo, moi lo noi bang '\\n' khong qua `limit` ky tu.
    Van ban dai hon `limit` dung mot minh mot lo (se duoc cat theo cau khi dich)."""
    batches, cur, size = [], [], 0
    for i, t in enumerate(texts):
        n = len(t) + 1
        if len(t) > limit:
            if cur:
                batches.append(cur)
                cur, size = [], 0
            batches.append([i])
            continue
        if cur and size + n > limit:
            batches.append(cur)
            cur, size = [], 0
        cur.append(i)
        size += n
    if cur:
        batches.append(cur)
    return batches


def norm_lang(code: str) -> str:
    return (code or "").strip().lower()


def pick_voice(lang: str, voices: list[dict] | None) -> str:
    """Chon giong doc cho ma ngon ngu (vi, en, zh-CN, th...)."""
    key = norm_lang(lang)
    if key in DEFAULT_VOICES:
        return DEFAULT_VOICES[key]
    base = key.split("-")[0]
    if base in DEFAULT_VOICES:
        return DEFAULT_VOICES[base]
    for v in voices or []:
        loc = norm_lang(v.get("Locale", ""))
        if loc == key or loc.startswith(base + "-"):
            return v["ShortName"]
    return FALLBACK_VOICE


def cache_key(voice: str, text: str) -> str:
    return hashlib.md5(f"{voice}|{text}".encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Dich (co cache RAM)
# ---------------------------------------------------------------------------
class TranslationCache:
    """LRU nho trong RAM: key = (nguon, dich, van ban). Gioi han so muc de khong an het bo nho."""

    def __init__(self, max_items: int = 50_000):
        self.max_items = max_items
        self.data: OrderedDict[tuple[str, str, str], str] = OrderedDict()

    def get(self, k):
        if k in self.data:
            self.data.move_to_end(k)
            return self.data[k]
        return None

    def put(self, k, v: str) -> None:
        self.data[k] = v
        self.data.move_to_end(k)
        while len(self.data) > self.max_items:
            self.data.popitem(last=False)


class RateLimited(Exception):
    """Google tra 429: dang bi gioi han tan suat."""


def parse_gtx(data) -> str:
    """Ket qua API gtx: [[["Hello world.", "Xin chao the gioi.", ...], ...], ...] -> noi cac doan da dich."""
    return "".join(seg[0] for seg in (data[0] or []) if seg and seg[0])


def gtx_translate(text: str, source: str, target: str) -> str:
    """API Google Translate dang 'gtx' (mien phi, khong can key). Gui van ban trong BODY (POST) nen khong bi gioi han do dai URL."""
    import requests  # co san vi deep-translator phu thuoc requests

    r = requests.post(GTX_URL, params={"client": "gtx", "sl": source, "tl": target, "dt": "t"},
                      data={"q": text}, timeout=20)
    if r.status_code == 429:
        raise RateLimited("Google 429 (gtx)")
    r.raise_for_status()
    return parse_gtx(r.json())


def deep_translate(text: str, source: str, target: str) -> str:
    """Duong du phong: deep-translator (dat van ban len URL nen phai cat nho)."""
    from deep_translator import GoogleTranslator  # import tai day de file test duoc ma khong can thu vien
    from deep_translator.exceptions import TooManyRequests

    tr = GoogleTranslator(source=source, target=target)
    out = []
    for c in split_text(text, FALLBACK_CHUNK) if len(text) > FALLBACK_CHUNK else [text]:
        try:
            out.append(tr.translate(c) or "")
        except TooManyRequests as e:
            raise RateLimited(str(e)) from e
        time.sleep(TRANSLATE_GAP_SEC)
    return " ".join(out)


def google_translate(text: str, source: str, target: str) -> str:
    """Dich 1 doan (dong bo, chay trong thread rieng). Thu gtx truoc, loi thi dung deep-translator; ca hai loi thi thu lai co gian cach."""
    last: Exception | None = None
    for wait in (0, *RETRY_WAITS):
        if wait:
            log(f"Google bao loi ({last}), thu lai sau {wait}s")
            time.sleep(wait)
        for fn in (gtx_translate, deep_translate):
            try:
                out = fn(text, source, target)
                time.sleep(TRANSLATE_GAP_SEC)   # nghi ngan giua cac lan goi de khong bi 429
                return out
            except Exception as e:  # noqa: BLE001
                last = e
                if isinstance(e, RateLimited):
                    break                       # dang bi 429 thi doi roi thu lai, khong goi tiep duong kia ngay
    raise last or RuntimeError("translate failed")


class Translator:
    def __init__(self, backend=google_translate, concurrency: int = TRANSLATE_CONCURRENCY):
        self.backend = backend
        self.cache = TranslationCache()
        self.sem = asyncio.Semaphore(concurrency)

    async def _call(self, text: str, source: str, target: str) -> str:
        async with self.sem:
            return await asyncio.to_thread(self.backend, text, source, target)

    async def _translate_batch(self, items: list[str], source: str, target: str) -> list[str]:
        if len(items) == 1:
            return [await self._call(items[0], source, target)]
        joined = "\n".join(items)
        out = (await self._call(joined, source, target)).split("\n")
        if len(out) == len(items):
            return [x.strip() for x in out]
        # Google doi so dong (hiem) -> dich tung cau rieng cho chac chan dung thu tu
        log(f"lo {len(items)} dong bi lech so dong ({len(out)}), dich tung dong")
        return list(await asyncio.gather(*(self._call(x, source, target) for x in items)))

    async def translate_many(self, texts: list[str], source: str, target: str) -> list[str]:
        src, dst = norm_lang(source), norm_lang(target)
        cleaned = [clean(t) for t in texts]
        if src == dst:
            return cleaned
        result: list[str | None] = [None] * len(cleaned)
        todo_idx, todo_txt, seen = [], [], {}
        for i, t in enumerate(cleaned):
            if not t:
                result[i] = ""
                continue
            hit = self.cache.get((src, dst, t))
            if hit is not None:
                result[i] = hit
            elif t in seen:                      # van ban trung nhau trong cung request: dich 1 lan
                continue
            else:
                seen[t] = len(todo_txt)
                todo_idx.append(i)
                todo_txt.append(t)
        if todo_txt:
            batches = make_batches(todo_txt)
            outs = await asyncio.gather(*(self._translate_batch([todo_txt[j] for j in b], source, target) for b in batches))
            for b, out in zip(batches, outs):
                for j, tr_text in zip(b, out):
                    self.cache.put((src, dst, todo_txt[j]), tr_text)
        for i, t in enumerate(cleaned):
            if result[i] is None:
                result[i] = self.cache.get((src, dst, t)) or ""
        return result  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Doc thanh audio (Edge-TTS, cache file)
# ---------------------------------------------------------------------------
class Speaker:
    def __init__(self, cache_dir: Path = CACHE_DIR):
        self.cache_dir = cache_dir
        self.voices: list[dict] | None = None
        self.locks: dict[str, asyncio.Lock] = {}

    async def voice_for(self, lang: str) -> str:
        key = norm_lang(lang)
        if key in DEFAULT_VOICES or key.split("-")[0] in DEFAULT_VOICES:
            return pick_voice(lang, None)
        if self.voices is None:
            try:
                import edge_tts

                self.voices = await edge_tts.list_voices()
            except Exception as e:  # noqa: BLE001
                log(f"khong lay duoc danh sach giong: {e}")
                return FALLBACK_VOICE   # khong luu lai: lan sau thu lay danh sach lan nua
        return pick_voice(lang, self.voices)

    async def synth(self, text: str, lang: str) -> Path:
        import edge_tts

        voice = await self.voice_for(lang)
        key = cache_key(voice, text)
        out = self.cache_dir / f"{key}.mp3"
        if out.exists():
            return out
        lock = self.locks.setdefault(key, asyncio.Lock())   # 2 nguoi cung bam nghe 1 quan: chi tao 1 lan
        async with lock:
            if not out.exists():
                self.cache_dir.mkdir(parents=True, exist_ok=True)
                tmp = out.with_suffix(".part")
                log(f"TTS lang={lang} voice={voice} ({len(text)} ky tu)")
                await edge_tts.Communicate(text, voice).save(str(tmp))
                tmp.replace(out)  # doi ten nguyen tu: khong ai doc phai file dang ghi do
        self.locks.pop(key, None)
        return out


def prune_cache(cache_dir: Path, days: int) -> int:
    if not cache_dir.exists():
        return 0
    limit = time.time() - days * 86400
    n = 0
    for f in cache_dir.glob("*"):
        if f.is_file() and f.stat().st_mtime < limit:
            f.unlink(missing_ok=True)
            n += 1
    return n


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
def json_error(web, status: int, code: str, message: str = ""):
    return web.json_response({"error": {"code": code, "message": message or code}}, status=status)


def build_app(translator: "Translator | None" = None, speaker: "Speaker | None" = None):
    from aiohttp import web

    translator = translator or Translator()
    speaker = speaker or Speaker()
    routes = web.RouteTableDef()

    @routes.get("/health")
    async def health(_req):
        return web.json_response({"status": "ok", "service": "content-service"})

    @routes.post("/translate")
    async def translate(req):
        try:
            body = await req.json()
        except json.JSONDecodeError:
            return json_error(web, 400, "INVALID_JSON")
        texts, target, source = body.get("texts"), str(body.get("target", "")), str(body.get("source", "vi"))
        if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts) or len(texts) > MAX_TEXTS:
            return json_error(web, 400, "INVALID_TEXTS", f"texts: mang chuoi, toi da {MAX_TEXTS} phan tu")
        if not LANG_RE.match(target) or not LANG_RE.match(source):
            return json_error(web, 400, "INVALID_LANG")
        t0 = time.time()
        try:
            out = await translator.translate_many(texts, source, target)
        except Exception as e:  # noqa: BLE001  (mat mang, Google chan, ngon ngu khong ho tro...)
            log(f"dich loi {source}->{target}: {e}")
            return json_error(web, 502, "TRANSLATE_FAILED", str(e)[:200])
        log(f"dich {len(texts)} doan {source}->{target} trong {time.time() - t0:.1f}s")
        return web.json_response({"texts": out})

    @routes.post("/tts")
    async def tts(req):
        try:
            body = await req.json()
        except json.JSONDecodeError:
            return json_error(web, 400, "INVALID_JSON")
        text, lang = clean(str(body.get("text", ""))), str(body.get("lang", ""))
        if not text or len(text) > MAX_TTS_CHARS:
            return json_error(web, 400, "INVALID_TEXT", f"text: 1-{MAX_TTS_CHARS} ky tu")
        if not LANG_RE.match(lang):
            return json_error(web, 400, "INVALID_LANG")
        try:
            path = await speaker.synth(text, lang)
        except Exception as e:  # noqa: BLE001
            log(f"TTS loi lang={lang}: {e}")
            return json_error(web, 502, "TTS_FAILED", str(e)[:200])
        return web.FileResponse(path, headers={"Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400"})

    app = web.Application(client_max_size=4 * 1024 * 1024)
    app.add_routes(routes)
    return app


def main() -> None:
    from aiohttp import web

    removed = prune_cache(CACHE_DIR, CACHE_DAYS)
    log(f"khoi dong cong {PORT}, cache audio {CACHE_DIR} (da xoa {removed} file cu)")
    web.run_app(build_app(), port=PORT, print=None)


if __name__ == "__main__":
    main()
