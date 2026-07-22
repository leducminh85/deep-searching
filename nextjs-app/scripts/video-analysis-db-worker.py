import concurrent.futures
import json
import os
import random
import re
import sys
import time

import ollama
import yt_dlp

MODEL = os.getenv("V3_OLLAMA_MODEL") or os.getenv("OLLAMA_MODEL", "qwen2.5:7b")
ANALYSIS_VERSION = "v3-qwen2.5-7b-detailed"
MIN_SUMMARY_WORDS = int(os.getenv("V3_MIN_SUMMARY_WORDS", "180"))
MAX_AI_RETRIES = int(os.getenv("DB_ANALYSIS_MAX_AI_RETRIES", "3"))
MAX_WORKERS = int(os.getenv("DB_ANALYSIS_MAX_WORKERS", "1"))
MIN_DELAY_SECONDS = float(os.getenv("DB_ANALYSIS_MIN_DELAY_SECONDS", "0"))
MAX_DELAY_SECONDS = float(os.getenv("DB_ANALYSIS_MAX_DELAY_SECONDS", "0"))


def configure_console_encoding():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


configure_console_encoding()


def emit(kind, payload):
    print(f"{kind}\t{json.dumps(payload, ensure_ascii=False)}", flush=True)


def log(level, message):
    emit("LOG", {"level": level, "message": str(message)})


def find_cookie_files():
    candidates = []
    for env_name in ("COOKIES_FILE", "COOKIES_FILE_2"):
        value = os.getenv(env_name)
        if value:
            candidates.append(value)

    cwd = os.getcwd()
    for name in ("cookies.txt", "cookies2.txt"):
        candidates.extend([
            os.path.join(cwd, name),
            os.path.join(cwd, "data", name),
            os.path.abspath(os.path.join(cwd, "..", name)),
        ])

    seen = set()
    files = []
    for candidate in candidates:
        resolved = os.path.abspath(candidate)
        if resolved not in seen and os.path.exists(resolved):
            seen.add(resolved)
            files.append(resolved)
    return files


COOKIE_FILES = find_cookie_files()
if COOKIE_FILES:
    log("success", f"Found {len(COOKIE_FILES)} cookie file(s).")
else:
    log("warning", "cookies.txt not found. YouTube may block caption access.")


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
    if not text or text == "#":
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
        "i can't provide a summary",
    ]
    if any(marker in lower for marker in refusal_markers):
        return True

    return len(text.split()) < 25


def is_bad_v3_summary(summary):
    if is_bad_summary(summary):
        return True

    text = str(summary).strip()
    upper_text = text.upper()
    required_sections = [
        "EXECUTIVE OVERVIEW",
        "DETAILED NARRATIVE",
        "PEOPLE",
        "TIMELINE",
        "SEARCH KEYWORDS",
    ]
    return len(text.split()) < MIN_SUMMARY_WORDS or not all(section in upper_text for section in required_sections)


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


def clean_for_db(text):
    if not isinstance(text, str):
        return text
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]", "", text)
    return text[:60000]


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

    languages = list(caption_groups.keys())
    ordered_languages = []

    for wanted in preferred_caption_languages():
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


def fetch_caption(video_url, video_id):
    cookies_to_try = COOKIE_FILES or [None]

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

            selected = choose_caption_track(info.get("subtitles", {}))
            caption_type = "manual"
            if not selected:
                selected = choose_caption_track(info.get("automatic_captions", {}))
                caption_type = "auto"

            if not selected:
                continue

            selected_lang, sub_url = selected
            log("info", f"Video {video_id}: using {caption_type} captions, language={selected_lang}.")

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
                log("warning", f"Video {video_id}: unavailable, private, removed, or restricted.")
                return "#"

    log("warning", f"Video {video_id}: no usable captions found.")
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


def generate_summary(caption_text, video_id, title="", channel_name="", published_at=""):
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
                    "num_ctx": int(os.getenv("V3_OLLAMA_NUM_CTX", os.getenv("OLLAMA_NUM_CTX", "32768"))),
                    "num_predict": int(os.getenv("V3_OLLAMA_NUM_PREDICT", os.getenv("OLLAMA_NUM_PREDICT", "2600"))),
                    "temperature": float(os.getenv("V3_OLLAMA_TEMPERATURE", os.getenv("OLLAMA_TEMPERATURE", "0.25"))),
                    "top_p": float(os.getenv("V3_OLLAMA_TOP_P", "0.9")),
                },
            )
            result = response["message"]["content"].strip()
            if not is_bad_v3_summary(result):
                return result
            log("warning", f"Video {video_id}: AI returned short or invalid v3 format on attempt {attempt}.")
            time.sleep(2)
        except Exception as exc:
            log("danger", f"Video {video_id}: Ollama v3 error on attempt {attempt}: {exc}")
            time.sleep(2)

    return ""


def process_task(task):
    video_id = task["id"]
    url = task.get("url") or ""
    existing_caption = task.get("caption") or ""
    existing_summary = task.get("summary") or ""

    if MIN_DELAY_SECONDS or MAX_DELAY_SECONDS:
        time.sleep(random.uniform(MIN_DELAY_SECONDS, max(MIN_DELAY_SECONDS, MAX_DELAY_SECONDS)))

    final_caption = existing_caption

    if not is_bad_summary(existing_summary):
        return {"id": video_id, "status": "skipped"}

    if not final_caption.strip() or "ERROR" in final_caption:
        log("info", f"Video {video_id}: fetching captions.")
        final_caption = fetch_caption(url, video_id)
        if final_caption == "IP_BLOCKED":
            return {"id": video_id, "status": "aborted", "error": "IP_BLOCKED"}

    if not final_caption or final_caption in {"#", "ERROR"}:
        return {
            "id": video_id,
            "status": "no_caption",
            "caption": None,
            "summary": None,
            "analysis_model": None,
            "analysis_version": None,
        }

    log("info", f"Video {video_id}: generating v3 summary with {MODEL}.")
    final_summary = generate_summary(
        final_caption,
        video_id,
        title=task.get("title") or "",
        channel_name=task.get("channel_name") or "",
        published_at=str(task.get("date_published") or ""),
    )

    if not final_summary:
        return {
            "id": video_id,
            "status": "error_ai",
            "caption": clean_for_db(final_caption),
            "summary": None,
            "analysis_model": None,
            "analysis_version": None,
        }

    return {
        "id": video_id,
        "status": "done",
        "caption": clean_for_db(final_caption),
        "summary": clean_for_db(final_summary),
        "analysis_model": MODEL,
        "analysis_version": ANALYSIS_VERSION,
    }


def main():
    tasks = []
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        tasks.append(json.loads(line))

    if not tasks:
        log("info", "No videos in analysis batch.")
        return 0

    log("info", f"Worker received {len(tasks)} videos, running {MAX_WORKERS} v3 worker(s) with {MODEL}.")
    aborted = False
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [executor.submit(process_task, task) for task in tasks]
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            emit("RESULT", result)
            if result.get("status") == "aborted":
                aborted = True

    return 2 if aborted else 0


if __name__ == "__main__":
    raise SystemExit(main())
