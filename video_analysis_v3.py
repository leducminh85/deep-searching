import argparse
import concurrent.futures
import json
import os
import random
import re
import sys
import threading
import time
from datetime import datetime
from urllib.parse import urlparse, urlunparse, quote

from dotenv import load_dotenv
import ollama
import psycopg2
import psycopg2.extras
import yt_dlp

load_dotenv()

MODEL = os.getenv("V3_OLLAMA_MODEL", "qwen2.5:7b")
ANALYSIS_VERSION = "v3-qwen2.5-7b-detailed"
DEFAULT_TARGET_DB = "deep_searching_v3"
DEFAULT_LIMIT = int(os.getenv("V3_ANALYSIS_LIMIT", "10000"))
DEFAULT_WORKERS = int(os.getenv("V3_ANALYSIS_WORKERS", "4"))
SAVE_EVERY = int(os.getenv("V3_SAVE_EVERY", "1"))
COOKIES_FILE = os.getenv("COOKIES_FILE", "cookies.txt")
COOKIES_FILE_2 = os.getenv("COOKIES_FILE_2", "cookies2.txt")
MIN_SUMMARY_WORDS = int(os.getenv("V3_MIN_SUMMARY_WORDS", "180"))
MAX_AI_RETRIES = int(os.getenv("V3_MAX_AI_RETRIES", "3"))
STOP_FILE = os.getenv("V3_STOP_FILE", "video_analysis_v3.stop")

stop_flag = False
success_count = 0
lock = threading.Lock()


def configure_console_encoding():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


configure_console_encoding()


def log(message):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] {message}", flush=True)


def request_stop(reason=""):
    global stop_flag
    stop_flag = True
    if reason:
        log(f"Yeu cau dung an toan: {reason}")


def stop_requested():
    return stop_flag or bool(STOP_FILE and os.path.exists(STOP_FILE))


def create_stop_file(path):
    with open(path, "w", encoding="utf-8") as file:
        file.write(f"stop requested at {datetime.now().isoformat()}\n")


def clear_stop_file(path):
    if path and os.path.exists(path):
        os.remove(path)


def build_database_url(db_name=None):
    if os.getenv("ANALYSIS_DATABASE_URL"):
        return os.getenv("ANALYSIS_DATABASE_URL")
    if os.getenv("LOCAL_DATABASE_URL"):
        return os.getenv("LOCAL_DATABASE_URL")
    if os.getenv("DATABASE_URL"):
        return os.getenv("DATABASE_URL")

    password = os.getenv("POSTGRES_PASSWORD")
    if not password:
        raise RuntimeError("Missing database config. Set ANALYSIS_DATABASE_URL, LOCAL_DATABASE_URL, DATABASE_URL, or POSTGRES_PASSWORD.")

    user = os.getenv("POSTGRES_USER", "postgres")
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    database = db_name or os.getenv("POSTGRES_APP_DB") or os.getenv("POSTGRES_DB") or DEFAULT_TARGET_DB
    return f"postgresql://{quote(user)}:{quote(password)}@{host}:{port}/{database}"


def database_name_from_url(database_url):
    parsed = urlparse(database_url)
    return parsed.path.lstrip("/")


def replace_database_name(database_url, database_name):
    parsed = urlparse(database_url)
    return urlunparse(parsed._replace(path=f"/{database_name}"))


def connect(database_url):
    return psycopg2.connect(database_url, cursor_factory=psycopg2.extras.RealDictCursor)


def ensure_v3_schema(conn):
    with conn.cursor() as cur:
        cur.execute("ALTER TABLE videos ADD COLUMN IF NOT EXISTS summary_v2_backup TEXT")
        cur.execute("ALTER TABLE videos ADD COLUMN IF NOT EXISTS analysis_model TEXT")
        cur.execute("ALTER TABLE videos ADD COLUMN IF NOT EXISTS analysis_version TEXT")
        cur.execute("ALTER TABLE videos ADD COLUMN IF NOT EXISTS analysis_updated_at TIMESTAMPTZ")
        cur.execute("""
            UPDATE videos
            SET summary_v2_backup = summary
            WHERE summary_v2_backup IS NULL
              AND NULLIF(btrim(summary), '') IS NOT NULL
        """)
    conn.commit()


def is_error_marker(text):
    marker = str(text or "").strip().upper()
    return (
        marker in {"ERROR", "ERROR_AI", "ABORTED", "IP_BLOCKED"}
        or marker.startswith("ERROR_")
        or marker.startswith("ERROR:")
    )


def is_bad_summary(summary):
    if summary is None:
        return True
    text = str(summary).strip()
    if not text:
        return True
    if text == "#":
        return True
    if is_error_marker(text):
        return True

    lower = text.lower()
    refusal_markers = [
        "i can't fulfill this request",
        "i cannot fulfill this request",
        "i can't assist",
        "i cannot assist",
        "i can't provide",
        "i cannot provide",
        "i can't provide assistance",
        "i can't provide a summary",
    ]
    if any(marker in lower for marker in refusal_markers):
        return True

    required_sections = [
        "executive overview",
        "detailed narrative",
        "people",
        "timeline",
        "search keywords",
    ]
    normalized = lower.replace("&", "and")
    return len(text.split()) < MIN_SUMMARY_WORDS or not all(section in normalized for section in required_sections)


def clean_for_db(text):
    if not isinstance(text, str):
        return text
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]", "", text)
    return text[:60000]


def sanitize_caption_for_ai(caption_text):
    caption = str(caption_text or "")
    replacements = [
        (r"\[ __ \]", " "),
        (r"\b(fuck|fucking|shit|bitch|asshole)\b", "profanity"),
        (r"\b(rape|raped|raping)\b", "sexual assault allegation"),
        (r"\b(kill|killed|killing|murder|murdered|homicide)\b", "serious harm incident"),
        (r"\b(shoot|shooting|shot|gun|firearm|weapon)\b", "weapon-related incident"),
        (r"\b(stab|stabbing|knife)\b", "sharp-object incident"),
        (r"\b(drugs?|narcotics?|cocaine|meth|fentanyl)\b", "substance-related allegation"),
    ]
    for pattern, replacement in replacements:
        caption = re.sub(pattern, replacement, caption, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", caption).strip()


def find_cookie_files():
    candidates = [COOKIES_FILE, COOKIES_FILE_2]
    files = []
    seen = set()
    for candidate in candidates:
        if not candidate:
            continue
        for path in [candidate, os.path.join("nextjs-app", "data", candidate), os.path.join("data", candidate)]:
            resolved = os.path.abspath(path)
            if resolved not in seen and os.path.exists(resolved):
                seen.add(resolved)
                files.append(resolved)
    return files


def language_matches(lang, wanted):
    lang = str(lang or "").lower()
    wanted = str(wanted or "").lower()
    return lang == wanted or lang.startswith(f"{wanted}-")


def preferred_caption_languages():
    configured = os.getenv("V3_CAPTION_LANG_PRIORITY", "en,vi")
    return [lang.strip().lower() for lang in configured.split(",") if lang.strip()]


def choose_caption_track(caption_groups):
    if not caption_groups:
        return None

    preferred = preferred_caption_languages()
    languages = list(caption_groups.keys())
    ordered_languages = []

    for wanted in preferred:
        ordered_languages.extend([lang for lang in languages if language_matches(lang, wanted)])

    ordered_languages.extend([lang for lang in languages if lang not in ordered_languages])

    for lang in ordered_languages:
        if str(lang).lower() == "live_chat":
            continue
        tracks = caption_groups.get(lang) or []
        for ext in ("json3", "json"):
            for item in tracks:
                if item.get("ext") == ext and item.get("url"):
                    return lang, item["url"]

    return None


def fetch_caption(video_url, row_id):
    cookies_to_try = find_cookie_files() or [None]

    for cookie_path in cookies_to_try:
        ydl_opts = {
            "skip_download": True,
            "quiet": True,
            "no_warnings": True,
            "ignore_no_formats_error": True,
        }
        if cookie_path:
            ydl_opts["cookiefile"] = cookie_path

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(video_url, download=False)
            if not info:
                continue

            subs = info.get("subtitles", {})
            auto_subs = info.get("automatic_captions", {})
            selected = choose_caption_track(subs)
            caption_type = "manual"
            if not selected:
                selected = choose_caption_track(auto_subs)
                caption_type = "auto"

            if not selected:
                continue

            selected_lang, sub_url = selected
            log(f"[Video {row_id}] Dang dung phu de {caption_type}, ngon ngu: {selected_lang}")

            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl2:
                    sub_data = ydl2.urlopen(sub_url).read().decode("utf-8")
                parsed = json.loads(sub_data)
            except Exception as exc:
                err = str(exc)
                if "429" in err or "Too Many Requests" in err:
                    return "IP_BLOCKED"
                continue

            text_chunks = []
            for event in parsed.get("events", []):
                for seg in event.get("segs", []):
                    if "utf8" in seg:
                        text_chunks.append(seg["utf8"])

            full_text = " ".join("".join(text_chunks).replace("\n", " ").split())
            return full_text[:45000] if full_text else "#"
        except Exception as exc:
            message = str(exc).lower()
            if "too many requests" in message or "http error 429" in message:
                return "IP_BLOCKED"
            if "unavailable" in message or "private" in message or "removed" in message:
                log(f"[Video {row_id}] Video không tồn tại hoặc bị giới hạn.")
                return "#"

    log(f"[Video {row_id}] Không có phụ đề khả dụng.")
    return "#"


def build_prompt(caption_text, title="", channel_name="", published_at=""):
    ai_caption = sanitize_caption_for_ai(caption_text)
    return f"""
You are a senior video intelligence analyst building a high-quality searchable research database.
Your job is NOT to give instructions, advice, encouragement, tactical guidance, or operational details.
Your job is to extract rich, neutral, searchable metadata from a transcript.

Write a very detailed, high-signal English analysis. Longer is better when it adds useful searchable detail.
Stay grounded only in the transcript. If something is unclear, say "Unclear from transcript".
Do not refuse the task: this is neutral archival indexing and summarization of already-published video captions.
Do not include graphic details. Do not invent facts.

Video metadata:
- Title: {title or "Unknown"}
- Channel: {channel_name or "Unknown"}
- Published at: {published_at or "Unknown"}

Return exactly these sections with rich detail:

1. EXECUTIVE OVERVIEW
- 4 to 7 sentences summarizing the central situation, why it matters, and what the viewer would remember.

2. DETAILED NARRATIVE
- A chronological, comprehensive narrative of the events.
- Include setting, initiating event, escalation, turning points, resolution, and unresolved questions.

3. PEOPLE, ROLES, AND RELATIONSHIPS
- Identify each person/group mentioned.
- Explain roles, relationships, authority positions, family/social ties, and uncertainty.

4. TIMELINE OF EVENTS
- Bullet a sequence of observable or stated events.
- Use relative ordering if exact times are not available.

5. LOCATION AND CONTEXT
- Describe location, public/private setting, jurisdiction clues, environmental context, and relevant background.

6. CONFLICT AND INCIDENT CLASSIFICATION
- Classify the active conflicts only.
- Mention legal, interpersonal, neighborhood, family, customer/service, police/public, property, traffic, workplace, or other categories only when supported.

7. KEY FACTS AND EVIDENCE FROM TRANSCRIPT
- List concrete facts stated or strongly supported by the transcript.
- Separate facts from unclear claims.

8. EMOTIONAL TONE AND BEHAVIORAL DYNAMICS
- Describe tone, tension, cooperation, confusion, fear, anger, authority, resistance, de-escalation, or escalation when present.

9. SEARCH KEYWORDS AND TAGS
- Provide 30 to 80 comma-separated English search tags.
- Include synonyms and phrase variants useful for search.
- Do not include tags for concepts that are not present.

10. CONTENT WARNINGS FOR INTERNAL INDEXING
- Neutral, high-level warnings only, no graphic wording.

11. ONE-SENTENCE SEARCH DESCRIPTION
- One dense sentence optimized for search result previews.

Transcript:
{ai_caption[:45000]}
"""


def generate_summary(caption_text, row_id, title="", channel_name="", published_at=""):
    if not caption_text or caption_text == "#" or len(str(caption_text).strip()) < 50:
        return ""

    prompt = build_prompt(caption_text, title, channel_name, published_at)
    for attempt in range(1, MAX_AI_RETRIES + 1):
        try:
            response = ollama.chat(
                model=MODEL,
                messages=[{"role": "user", "content": prompt}],
                stream=False,
                options={
                    "num_ctx": int(os.getenv("V3_OLLAMA_NUM_CTX", "32768")),
                    "num_predict": int(os.getenv("V3_OLLAMA_NUM_PREDICT", "2600")),
                    "temperature": float(os.getenv("V3_OLLAMA_TEMPERATURE", "0.25")),
                    "top_p": float(os.getenv("V3_OLLAMA_TOP_P", "0.9")),
                },
            )
            result = response["message"]["content"].strip()
            if not is_bad_summary(result):
                return result
            log(f"[Video {row_id}] AI trả lời quá ngắn/sai format lần {attempt}: {result[:120]!r}")
            time.sleep(2)
        except Exception as exc:
            log(f"[Video {row_id}] Lỗi Ollama lần {attempt}: {exc}")
            time.sleep(2)

    return ""


def select_tasks(conn, limit):
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, title, url, channel_name, date_published, caption, summary
            FROM videos
            WHERE url ~* 'youtube\\.com|youtu\\.be'
              AND (
                  summary IS NULL
                  OR btrim(summary) = ''
                  OR btrim(summary) = '#'
                  OR upper(btrim(summary)) IN ('ERROR', 'ERROR_AI', 'ABORTED', 'IP_BLOCKED')
                  OR upper(btrim(summary)) LIKE 'ERROR:%%'
              )
            ORDER BY date_published DESC NULLS LAST, id ASC
            LIMIT %s
        """, (limit,))
        return cur.fetchall()


def process_video(row):
    global success_count

    if stop_requested():
        return {"id": row["id"], "status": "ABORTED"}

    time.sleep(random.uniform(1.5, 4.0))
    if stop_requested():
        return {"id": row["id"], "status": "ABORTED"}

    row_id = row["id"]
    log(f"▶ Đang xử lý video {row_id}: {row.get('title') or 'Untitled'}")

    caption = row.get("caption") or ""
    if not caption.strip() or "ERROR" in caption:
        log(f"[Video {row_id}] Đang tải phụ đề...")
        caption = fetch_caption(row["url"], row_id)
        if caption == "IP_BLOCKED":
            request_stop("YouTube chan IP khi tai phu de")
            return {"id": row_id, "status": "ABORTED", "caption": "ABORTED", "summary": "ABORTED"}

    if stop_requested():
        return {"id": row_id, "status": "ABORTED", "caption": caption, "summary": ""}

    if not caption or caption == "#":
        return {"id": row_id, "status": "SKIPPED", "caption": "", "summary": ""}

    summary = generate_summary(
        caption,
        row_id,
        title=row.get("title") or "",
        channel_name=row.get("channel_name") or "",
        published_at=str(row.get("date_published") or ""),
    )

    with lock:
        success_count += 1

    return {
        "id": row_id,
        "status": "DONE" if summary else "ERROR_AI",
        "caption": clean_for_db(caption),
        "summary": clean_for_db(summary) if summary else "",
    }


def write_result(conn, result):
    if result["status"] == "ABORTED":
        return

    with conn.cursor() as cur:
        if result["status"] == "SKIPPED":
            cur.execute("""
                UPDATE videos
                SET caption = NULL,
                    summary = NULL,
                    analysis_model = NULL,
                    analysis_version = NULL,
                    analysis_updated_at = NULL
                WHERE id = %s
            """, (result["id"],))
        elif result["status"] == "DONE":
            cur.execute("""
                UPDATE videos
                SET caption = %s,
                    summary = %s,
                    analysis_model = %s,
                    analysis_version = %s,
                    analysis_updated_at = NOW()
                WHERE id = %s
            """, (result["caption"], result["summary"], MODEL, ANALYSIS_VERSION, result["id"]))
        else:
            cur.execute("""
                UPDATE videos
                SET caption = COALESCE(NULLIF(%s, ''), caption),
                    summary = NULL,
                    analysis_model = NULL,
                    analysis_version = NULL,
                    analysis_updated_at = NULL
                WHERE id = %s
            """, (result.get("caption") or "", result["id"]))
    conn.commit()


def main():
    global STOP_FILE

    parser = argparse.ArgumentParser(description="Run detailed v3 video analysis directly against PostgreSQL.")
    parser.add_argument("--database-url", default=None, help="Target DB URL. Defaults to ANALYSIS_DATABASE_URL/LOCAL_DATABASE_URL.")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    parser.add_argument("--stop-file", default=STOP_FILE, help="File used to request a safe stop.")
    parser.add_argument("--stop", action="store_true", help="Create the stop file and exit.")
    parser.add_argument("--clear-stop", action="store_true", help="Remove the stop file before starting.")
    parser.add_argument("--allow-production-db", action="store_true", help="Allow running against DB names that do not end with _v3.")
    args = parser.parse_args()
    STOP_FILE = args.stop_file

    if args.stop:
        create_stop_file(STOP_FILE)
        log(f"Da tao stop file: {STOP_FILE}")
        return

    if args.clear_stop:
        clear_stop_file(STOP_FILE)

    if stop_requested():
        raise SystemExit(f"Stop file dang ton tai ({STOP_FILE}). Dung --clear-stop de chay lai.")

    database_url = args.database_url or build_database_url()
    db_name = database_name_from_url(database_url)

    if not args.allow_production_db and not db_name.endswith("_v3"):
        raise SystemExit(
            f"Refusing to run v3 analysis against '{db_name}'. "
            "Clone to deep_searching_v3 first or pass --allow-production-db intentionally."
        )

    log(f"Đang kết nối database: {db_name}")
    log(f"Model phân tích: {MODEL}")
    conn = connect(database_url)
    ensure_v3_schema(conn)
    tasks = select_tasks(conn, args.limit)
    log(f"Tìm thấy {len(tasks)} video cần phân tích v3.")

    if not tasks:
        conn.close()
        log("Không còn video cần xử lý.")
        return

    log(f"Bắt đầu chạy với {args.workers} luồng. Qwen 7B nặng hơn, nên ưu tiên chất lượng hơn tốc độ.")
    workers = max(args.workers, 1)
    completed = 0
    submitted = 0
    task_iter = iter(tasks)

    def fill_queue(executor, futures):
        nonlocal submitted
        while len(futures) < workers and not stop_requested():
            try:
                row = next(task_iter)
            except StopIteration:
                return
            futures.add(executor.submit(process_video, row))
            submitted += 1

    def handle_future(future):
        nonlocal completed
        try:
            result = future.result()
        except Exception as exc:
            completed += 1
            log(f"Loi task worker: {exc}")
            return

        write_result(conn, result)
        completed += 1
        if completed % SAVE_EVERY == 0:
            log(f"Da ghi {completed}/{submitted} ket qua vao database.")
        if result.get("status") == "ABORTED":
            request_stop("task bao abort")

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
            futures = set()
            fill_queue(executor, futures)
            while futures:
                try:
                    done, futures = concurrent.futures.wait(
                        futures,
                        return_when=concurrent.futures.FIRST_COMPLETED,
                    )
                except KeyboardInterrupt:
                    request_stop("nhan Ctrl+C")
                    log("Dang cho cac video dang chay hoan tat de ghi database...")
                    done, futures = concurrent.futures.wait(futures)

                for future in done:
                    handle_future(future)

                fill_queue(executor, futures)

            if stop_requested():
                log("Da dung an toan. Khong cap them video moi, cac ket qua dang chay da duoc ghi.")
            else:
                log("Hoan tat video_analysis_v3.")
            return
            futures = [executor.submit(process_video, row) for row in tasks]
            for future in concurrent.futures.as_completed(futures):
                result = future.result()
                write_result(conn, result)
                completed += 1
                if completed % SAVE_EVERY == 0:
                    log(f"Đã ghi {completed}/{len(tasks)} kết quả vào database.")
                if result.get("status") == "ABORTED":
                    log("Dừng vì YouTube chặn IP hoặc task bị abort.")
                    break
    finally:
        conn.close()

    log("Hoàn tất video_analysis_v3.")


if __name__ == "__main__":
    main()
