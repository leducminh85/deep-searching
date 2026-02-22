import youtube_transcript_api
from youtube_transcript_api import YouTubeTranscriptApi

print("================ CHẨN ĐOÁN LỖI ================")
print("1. File thư viện đang được đọc từ:")
print("👉", youtube_transcript_api.__file__)

print("\n2. Các hàm thực sự có bên trong thư viện này:")
ham_co_san = [m for m in dir(YouTubeTranscriptApi) if not m.startswith('__')]
print("👉", ham_co_san)
print("===============================================")