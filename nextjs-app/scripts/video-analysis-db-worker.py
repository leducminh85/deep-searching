import concurrent.futures
import json
import os
import random
import re
import sys
import time

import ollama
import yt_dlp

MIN_SUMMARY_WORDS = 25
MAX_AI_RETRIES = int(os.getenv("DB_ANALYSIS_MAX_AI_RETRIES", "3"))
MAX_WORKERS = int(os.getenv("DB_ANALYSIS_MAX_WORKERS", "2"))
MIN_DELAY_SECONDS = float(os.getenv("DB_ANALYSIS_MIN_DELAY_SECONDS", "3"))
MAX_DELAY_SECONDS = float(os.getenv("DB_ANALYSIS_MAX_DELAY_SECONDS", "7"))


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
    env_cookie = os.getenv("COOKIES_FILE")
    env_cookie_2 = os.getenv("COOKIES_FILE_2")
    if env_cookie:
        candidates.append(env_cookie)
    if env_cookie_2:
        candidates.append(env_cookie_2)

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
    log("success", f"Đã tìm thấy {len(COOKIE_FILES)} file cookies.")
else:
    log("warning", "Không tìm thấy cookies.txt. YouTube có thể chặn caption.")


def is_error_marker(text):
    marker = str(text or "").strip().upper()
    return (
        marker in {"ERROR", "ERROR_AI", "ABORTED", "IP_BLOCKED"}
        or marker.startswith("ERROR_")
        or marker.startswith("ERROR:")
    )


def sanitize_caption_for_ai(caption_text):
    caption = str(caption_text or "")
    replacements = [
        (r"\[ __ \]", " "),
        (r"\b(fuck|fucking|shit|bitch|asshole)\b", "profanity"),
        (r"\b(dick|pussy|penis|vagina|sex)\b", "explicit term"),
        (r"\b(rape|raped|raping)\b", "sexual assault allegation"),
        (r"\b(kill|killed|killing|murder|murdered)\b", "harm"),
    ]
    for pattern, replacement in replacements:
        caption = re.sub(pattern, replacement, caption, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", caption).strip()


def clean_for_db(text):
    if not isinstance(text, str):
        return text
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]", "", text)
    return text[:32000]


def is_bad_summary(summary):
    if summary is None:
        return True

    text = str(summary).strip()
    if not text:
        return True
    if text == "#":
        return False
    if is_error_marker(text):
        return True

    refusal_markers = [
        "I can't fulfill this request",
        "I cannot fulfill this request",
        "I can't assist",
        "I cannot assist",
        "I can't provide",
        "I cannot provide",
    ]
    if any(marker.lower() in text.lower() for marker in refusal_markers):
        return True

    upper_text = text.upper()
    has_main_story = "MAIN STORY" in upper_text
    has_conflict_section = "TYPE OF CONFLICT" in upper_text or "CONFLICT TYPE" in upper_text
    return len(text.split()) < MIN_SUMMARY_WORDS or not (has_main_story and has_conflict_section)


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

            subs = info.get("subtitles", {})
            auto_subs = info.get("automatic_captions", {})
            sub_url = None

            target_langs = [key for key in subs.keys() if key.lower().startswith("en")]
            if target_langs:
                preferred = "en" if "en" in target_langs else target_langs[0]
                for item in subs[preferred]:
                    if item.get("ext") in ["json3", "json"]:
                        sub_url = item["url"]
                        break

            if not sub_url:
                for lang in auto_subs.keys():
                    if not lang.startswith("en"):
                        continue
                    for item in auto_subs[lang]:
                        if item.get("ext") in ["json3", "json"]:
                            sub_url = item["url"]
                            break
                    if sub_url:
                        break

            if not sub_url:
                continue

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
            return full_text[:30000] if full_text else "#"
        except Exception as exc:
            message = str(exc).lower()
            if "too many requests" in message or "http error 429" in message:
                return "IP_BLOCKED"
            if "unavailable" in message or "private" in message or "removed" in message:
                log("warning", f"Video {video_id}: không tồn tại hoặc bị giới hạn.")
                return "#"

    log("warning", f"Video {video_id}: không có phụ đề tiếng Anh.")
    return "#"


def generate_summary(caption_text, video_id):
    if not caption_text or caption_text == "#" or len(str(caption_text).strip()) < 50:
        return ""

    ai_caption = sanitize_caption_for_ai(caption_text)
    prompt = f"""
    You are a video data analyst. Read the YouTube subtitles below, summarize and analyze the content for in-depth research.
    This is a passive transcript-indexing task for a searchable video database. Some transcripts may include sensitive or crime-related material.
    Do not provide instructions, advice, encouragement, or operational details for wrongdoing. Keep the wording neutral, high-level, and non-graphic.

    Please answer in the following format (write concisely and directly in English):

    1. MAIN STORY: (Briefly describe what happened in 2-3 sentences).
    2. CHARACTERS & RELATIONSHIPS: (Who is involved? What is their relationship?)
    3. LOCATION / CONTEXT: (Where did the event take place?)
    4. TYPE OF CONFLICT: (Property conflict, verbal, physical, legal, neighbor conflict, racial discrimination, boyfriend/girlfriend, free citizen, etc.)
    5. SPECIFIC KEYWORDS (TAGS):

    STRICT RULES FOR PARTS 4 & 5:
    - NO NEGATIVE LISTING: ONLY list types of conflict or keywords that are PRESENT and ACTIVE in the video.
    - ONLY list keywords when the situation ACTUALLY occurs, is clearly stated, or is the main focus of the video.
    - NEVER include any keywords if the situation is only briefly mentioned, hypothetical, or superficial.
    - Only use accurate, specialized English keywords.
    - ANTI-HALLUCINATION RULE: Do NOT guess or hypothesize. If a detail is not explicitly stated or clearly implied, write "Undetermined" or "Unclear from transcript".
    - NO SPECULATION: Only analyze based on what is actually present in the text.

    Caption:
    {ai_caption[:30000]}
    """

    for attempt in range(1, MAX_AI_RETRIES + 1):
        try:
            response = ollama.chat(
                model=os.getenv("OLLAMA_MODEL", "llama3.2:3b"),
                messages=[{"role": "user", "content": prompt}],
                stream=False,
                options={
                    "num_ctx": int(os.getenv("OLLAMA_NUM_CTX", "16384")),
                    "num_predict": int(os.getenv("OLLAMA_NUM_PREDICT", "700")),
                    "temperature": float(os.getenv("OLLAMA_TEMPERATURE", "0.2")),
                },
            )
            result = response["message"]["content"].strip()
            if not is_bad_summary(result):
                return result
            log("warning", f"Video {video_id}: AI trả sai format lần {attempt}.")
            time.sleep(2)
        except Exception as exc:
            log("danger", f"Video {video_id}: lỗi Ollama lần {attempt}: {exc}")
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
    final_summary = existing_summary

    if not final_caption.strip() or "ERROR" in final_caption:
        log("info", f"Video {video_id}: đang tải phụ đề.")
        final_caption = fetch_caption(url, video_id)
        if final_caption == "IP_BLOCKED":
            return {"id": video_id, "status": "aborted", "error": "IP_BLOCKED"}

    if final_caption and final_caption not in {"#", "ERROR"} and is_bad_summary(existing_summary):
        log("info", f"Video {video_id}: đang tạo summary bằng Ollama.")
        final_summary = generate_summary(final_caption, video_id)

    return {
        "id": video_id,
        "status": "done",
        "caption": clean_for_db(final_caption) if final_caption else None,
        "summary": clean_for_db(final_summary) if final_summary else None,
    }


def main():
    tasks = []
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        tasks.append(json.loads(line))

    if not tasks:
        log("info", "Không có video trong batch phân tích.")
        return 0

    log("info", f"Worker nhận {len(tasks)} video, chạy {MAX_WORKERS} luồng.")
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
