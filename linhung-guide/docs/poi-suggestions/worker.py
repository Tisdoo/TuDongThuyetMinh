"""
GOI Y: Content Pipeline Worker (UC-S05) - Python.
Doc hang doi content_jobs trong poi_db, dich van ban + sinh audio TTS, upload Blob, cap nhat poi_translations.

pip install psycopg[binary] azure-ai-translation-text azure-cognitiveservices-speech azure-storage-blob
Cac ham translate()/synthesize()/upload() la STUB: thay bang SDK Azure that (hoac OpenAI/Google).
"""
import os
import time
import psycopg

DSN = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/poi_db")
MAX_ATTEMPTS = 3


def translate(text: str, target_lang: str) -> str:
    raise NotImplementedError("Goi Azure Translator o day")


def synthesize(text: str, voice: str) -> tuple[bytes, int]:
    raise NotImplementedError("Goi Azure Speech TTS o day, tra ve (mp3_bytes, duration_sec)")


def upload(path: str, data: bytes) -> str:
    raise NotImplementedError("Upload Azure Blob, tra ve URL CDN")


def claim_job(conn):
    # SKIP LOCKED: nhieu worker chay song song khong dap job cua nhau
    return conn.execute(
        """
        UPDATE content_jobs SET status='RUNNING', started_at=now(), attempts=attempts+1
         WHERE id = (SELECT id FROM content_jobs WHERE status='QUEUED'
                      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, translation_id, job_type, attempts
        """
    ).fetchone()


def process(conn, job):
    job_id, tr_id, job_type, _ = job
    t = conn.execute(
        """SELECT t.poi_id, t.lang_code, t.is_source, l.tts_voice
             FROM poi_translations t JOIN languages l ON l.code = t.lang_code WHERE t.id=%s""",
        (tr_id,),
    ).fetchone()
    poi_id, lang, _is_source, voice = t

    if job_type == "TRANSLATE":
        src = conn.execute(
            "SELECT name, short_description, description FROM poi_translations WHERE poi_id=%s AND lang_code='vi'",
            (poi_id,),
        ).fetchone()
        name, short, desc = (translate(x, lang) for x in src)
        conn.execute(
            """UPDATE poi_translations SET name=%s, short_description=%s, description=%s,
                      status='TRANSLATED', updated_at=now() WHERE id=%s""",
            (name, short, desc, tr_id),
        )
        conn.execute("INSERT INTO content_jobs (translation_id, job_type) VALUES (%s,'TTS')", (tr_id,))
    else:  # TTS
        desc = conn.execute("SELECT description FROM poi_translations WHERE id=%s", (tr_id,)).fetchone()[0]
        mp3, dur = synthesize(desc, voice)
        url = upload(f"audio/{poi_id}/{lang}.mp3", mp3)
        conn.execute(
            """UPDATE poi_translations SET audio_url=%s, audio_duration_sec=%s, status='AUDIO_READY',
                      updated_at=now() WHERE id=%s""",
            (url, dur, tr_id),
        )
    conn.execute("UPDATE content_jobs SET status='DONE', finished_at=now() WHERE id=%s", (job_id,))


def main():
    with psycopg.connect(DSN, autocommit=False) as conn:
        while True:
            job = claim_job(conn)
            conn.commit()
            if not job:
                time.sleep(2)
                continue
            try:
                process(conn, job)
                conn.commit()
            except Exception as e:  # noqa: BLE001
                conn.rollback()
                status = "FAILED" if job[3] >= MAX_ATTEMPTS else "QUEUED"
                conn.execute(
                    "UPDATE content_jobs SET status=%s, error_message=%s, finished_at=now() WHERE id=%s",
                    (status, str(e)[:500], job[0]),
                )
                conn.commit()


if __name__ == "__main__":
    main()
