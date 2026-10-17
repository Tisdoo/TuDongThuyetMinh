"""
Content Worker: dich tu dong + tao audio thuyet minh (Edge-TTS) cho POI.

Luong: admin luu noi dung tieng Viet -> POI Service xep job vao bang content_jobs ->
worker nay lay job, dich (deep-translator) roi doc thanh MP3 (Edge-TTS) -> ghi audio_url vao poi_translations.
Ca hai dich vu deu MIEN PHI, khong can API key, nhung can Internet.

Thiet ke:
- Hang doi bang chinh PostgreSQL (SELECT ... FOR UPDATE SKIP LOCKED): chay nhieu worker song song khong lay trung job.
- Job treo (worker chet giua chung) tu duoc dua ve QUEUED sau STALE_MINUTES.
- Cache audio theo MD5(giong|van ban): van ban khong doi thi KHONG goi lai TTS (tiet kiem, nhanh).
- TTS loi thi ban dich van dung duoc: app se roi ve giong doc cua trinh duyet.
"""
import asyncio
import hashlib
import os
import re
import time
from pathlib import Path

import psycopg

DSN = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/poi_db")
AUDIO_DIR = Path(os.getenv("AUDIO_DIR", "./audio"))
MAX_ATTEMPTS = int(os.getenv("MAX_ATTEMPTS", "3"))
POLL_SECONDS = float(os.getenv("POLL_SECONDS", "2"))
STALE_MINUTES = int(os.getenv("STALE_MINUTES", "5"))
TRANSLATE_CHUNK = 4500  # gioi han ky tu moi lan goi dich cua deep-translator
DEFAULT_VOICE = "en-US-JennyNeural"


def log(msg: str) -> None:
    print(f"[worker] {msg}", flush=True)


# ---------- ham thuan (de kiem thu) ----------
def split_text(text: str, limit: int = TRANSLATE_CHUNK) -> list[str]:
    """Cat van ban theo cau, moi doan khong qua `limit` ky tu."""
    parts = re.findall(r"[^.!?\n]+[.!?]?\s*", text) or [text]
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


def cache_key(voice: str, text: str) -> str:
    return hashlib.md5(f"{voice}|{text}".encode("utf-8")).hexdigest()


def narration_text(name: str, description: str) -> str:
    """Van ban doc: ten diem, sau do mo ta day du."""
    return f"{name.strip()}. {description.strip()}".strip()


# ---------- dich va tao audio ----------
def translate_text(text: str, target: str) -> str:
    if not text.strip():
        return ""
    from deep_translator import GoogleTranslator  # import tai day de file test duoc ma khong can thu vien

    translator = GoogleTranslator(source="vi", target=target)
    return " ".join(translator.translate(chunk) for chunk in split_text(text))


async def _synthesize(text: str, voice: str, out: Path) -> None:
    import edge_tts

    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(out.stem + ".part.mp3")
    await edge_tts.Communicate(text, voice).save(str(tmp))
    tmp.replace(out)  # doi ten nguyen tu: nguoi nghe khong bao gio gap file ghi do


def mp3_seconds(path: Path) -> int:
    from mutagen.mp3 import MP3

    return int(round(MP3(str(path)).info.length))


def make_audio(poi_id: str, lang: str, text: str, voice: str) -> tuple[str, int]:
    """Tra ve (audio_url, thoi_luong_giay). Dung cache neu van ban va giong khong doi."""
    mp3 = AUDIO_DIR / str(poi_id) / f"{lang}.mp3"
    sidecar = mp3.with_suffix(".md5")
    key = cache_key(voice, text)
    if mp3.exists() and sidecar.exists() and sidecar.read_text().strip() == key:
        log(f"cache HIT {poi_id}/{lang}")
    else:
        log(f"TTS {poi_id}/{lang} voice={voice} ({len(text)} chars)")
        asyncio.run(_synthesize(text, voice, mp3))
        sidecar.write_text(key)
    return f"/audio/{poi_id}/{lang}.mp3?v={key[:8]}", mp3_seconds(mp3)


# ---------- xu ly job ----------
def claim_job(conn):
    return conn.execute(
        """
        UPDATE content_jobs SET status='RUNNING', started_at=now(), attempts=attempts+1
         WHERE id = (SELECT id FROM content_jobs WHERE status='QUEUED'
                      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, translation_id, job_type, attempts
        """
    ).fetchone()


def recover_stale(conn) -> None:
    n = conn.execute(
        "UPDATE content_jobs SET status='QUEUED' WHERE status='RUNNING' AND started_at < now() - make_interval(mins => %s)",
        (STALE_MINUTES,),
    ).rowcount
    if n:
        log(f"dua {n} job treo ve hang doi")


def load_translation(conn, translation_id):
    return conn.execute(
        """SELECT t.id, t.poi_id, t.lang_code, t.name, t.short_description, t.description,
                  t.translation_origin, t.audio_url, l.tts_voice
             FROM poi_translations t JOIN languages l ON l.code = t.lang_code
            WHERE t.id=%s""",
        (translation_id,),
    ).fetchone()


def do_translate(conn, t) -> None:
    tid, poi_id, lang, _name, _short, _desc, origin, _audio, _voice = t
    if origin == "HUMAN":
        log(f"bo qua {poi_id}/{lang}: ban dich tay, khong ghi de")
        return
    src = conn.execute(
        "SELECT name, short_description, description FROM poi_translations WHERE poi_id=%s AND lang_code='vi'",
        (poi_id,),
    ).fetchone()
    if not src or not src[0] or not src[2]:
        raise ValueError("Chua co noi dung tieng Viet de dich")
    name, short, desc = (translate_text(x or "", lang) for x in src)
    with conn.transaction():
        conn.execute(
            """UPDATE poi_translations
                  SET name=%s, short_description=%s, description=%s, audio_url=NULL, audio_duration_sec=NULL,
                      translation_origin='MACHINE', status='TRANSLATED', version=version+1, updated_at=now()
                WHERE id=%s""",
            (name, short, desc, tid),
        )
        conn.execute("INSERT INTO content_jobs (translation_id, job_type) VALUES (%s,'TTS')", (tid,))
    log(f"da dich {poi_id}/{lang}")


def do_tts(conn, t) -> None:
    tid, poi_id, lang, name, _short, desc, _origin, _audio, voice = t
    if not desc or not name:
        log(f"bo qua TTS {poi_id}/{lang}: chua co noi dung")
        return
    url, seconds = make_audio(str(poi_id), lang, narration_text(name, desc), voice or DEFAULT_VOICE)
    conn.execute(
        """UPDATE poi_translations
              SET audio_url=%s, audio_duration_sec=%s, audio_format='mp3',
                  status = CASE WHEN status='REVIEWED' THEN 'REVIEWED' ELSE 'AUDIO_READY' END, updated_at=now()
            WHERE id=%s""",
        (url, seconds, tid),
    )


def process(conn, job) -> None:
    job_id, tid, job_type, attempts = job
    try:
        t = load_translation(conn, tid)
        if not t:
            raise ValueError("Khong tim thay ban dich")
        (do_translate if job_type == "TRANSLATE" else do_tts)(conn, t)
        conn.execute("UPDATE content_jobs SET status='DONE', finished_at=now(), error_message=NULL WHERE id=%s", (job_id,))
    except Exception as e:  # noqa: BLE001
        final = attempts >= MAX_ATTEMPTS
        log(f"loi job {job_id} ({job_type}, lan {attempts}/{MAX_ATTEMPTS}): {e}")
        conn.execute(
            "UPDATE content_jobs SET status=%s, error_message=%s, finished_at=now() WHERE id=%s",
            ("FAILED" if final else "QUEUED", str(e)[:500], job_id),
        )
        if final and job_type == "TRANSLATE":
            conn.execute("UPDATE poi_translations SET status='FAILED' WHERE id=%s", (tid,))


def main() -> None:
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    log(f"khoi dong, audio -> {AUDIO_DIR}")
    last_recover = 0.0
    while True:
        try:
            with psycopg.connect(DSN, autocommit=True) as conn:
                while True:
                    if time.time() - last_recover > 60:
                        recover_stale(conn)
                        last_recover = time.time()
                    job = claim_job(conn)
                    if job:
                        process(conn, job)
                    else:
                        time.sleep(POLL_SECONDS)
        except psycopg.errors.UndefinedTable:
            log("bang content_jobs chua co (POI Service dang tao CSDL), thu lai sau 5 giay")
            time.sleep(5)
        except psycopg.Error as e:
            log(f"mat ket noi CSDL: {e}. Thu lai sau 5 giay")
            time.sleep(5)


if __name__ == "__main__":
    main()
