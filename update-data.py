import openpyxl
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from googleapiclient.discovery import build
import concurrent.futures
import re
import os
from dotenv import load_dotenv

# Load môi trường từ .env
load_dotenv()

# --- CẤU HÌNH ---
FILE_PATH = "data.xlsx"
CHANNEL_LIST_SHEET = "Channel Lisitng" 
CACHE_SHEET = "NEW_CACHE_DATA_HIDDEN_"
MAX_WORKERS = 3 # Số lượng thread (API có giới hạn quota nên không nên để quá cao)

# Lấy API Key từ .env hoặc bạn có thể điền thẳng vào đây (không khuyến khích nếu push git)
API_KEY = os.getenv("YOUTUBE_API_KEY")

def clean_for_excel(text):
    """Tẩy rửa triệt để các ký tự rác làm hỏng cấu trúc XML của Excel"""
    if not isinstance(text, str):
        return text
    text = ILLEGAL_CHARACTERS_RE.sub('', text)
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]', '', text)
    return text[:32000]

def parse_duration(duration_str):
    """Chuyển đổi định dạng ISO 8601 (PT1M5S) sang giây"""
    hours = re.search(r'(\d+)H', duration_str)
    minutes = re.search(r'(\d+)M', duration_str)
    seconds = re.search(r'(\d+)S', duration_str)
    
    total_seconds = 0
    if hours: total_seconds += int(hours.group(1)) * 3600
    if minutes: total_seconds += int(minutes.group(1)) * 60
    if seconds: total_seconds += int(seconds.group(1))
    return total_seconds

def get_channel_id_and_uploads_id(youtube, url):
    """Lấy Channel ID và Playlist 'Uploads' ID từ URL YouTube"""
    try:
        # Xử lý handle: @name
        handle_match = re.search(r'(@[\w.-]+)', url)
        if handle_match:
            handle = handle_match.group(1)
            res = youtube.channels().list(part="contentDetails", forHandle=handle).execute()
            if res.get('items'):
                item = res['items'][0]
                return item['id'], item['contentDetails']['relatedPlaylists']['uploads']
        
        # Xử lý channel/ID
        id_match = re.search(r'channel/(UC[\w-]{22})', url)
        if id_match:
            ch_id = id_match.group(1)
            res = youtube.channels().list(part="contentDetails", id=ch_id).execute()
            if res.get('items'):
                uploads_id = res['items'][0]['contentDetails']['relatedPlaylists']['uploads']
                return ch_id, uploads_id

        # Xử lý /user/
        user_match = re.search(r'user/([\w.-]+)', url)
        if user_match:
            user = user_match.group(1)
            res = youtube.channels().list(part="contentDetails", forUsername=user).execute()
            if res.get('items'):
                item = res['items'][0]
                return item['id'], item['contentDetails']['relatedPlaylists']['uploads']

    except Exception as e:
        print(f"❌ Lỗi khi lấy ID cho {url}: {e}")
    return None, None

def get_all_videos_from_playlist(youtube, playlist_id, channel_name):
    """Lấy toàn bộ video từ playlist uploads sử dụng API v3"""
    videos = []
    next_page_token = None
    
    try:
        while True:
            request = youtube.playlistItems().list(
                part="snippet,contentDetails",
                playlistId=playlist_id,
                maxResults=50,
                pageToken=next_page_token
            )
            response = request.execute()
            
            for item in response.get('items', []):
                snippet = item['snippet']
                video_id = snippet['resourceId']['videoId']
                video_url = f"https://www.youtube.com/watch?v={video_id}"
                
                # Để lấy view count, ta cần list video lần nữa (v3 playlistItems không trả view count)
                # Tuy nhiên để tối ưu quota, ta gom lại lấy sau hoặc lấy title trước.
                # Theo yêu cầu "Lấy các thông tin cần thiết như trong file data.xlsx đã có sẵn", 
                # Ta cần Title, URL, Views, Thumbnail, Date Published, Channel Name.
                
                videos.append({
                    'id': video_id,
                    'Title': clean_for_excel(snippet['title']),
                    'URL': video_url,
                    'Thumbnail': snippet.get('thumbnails', {}).get('high', {}).get('url') or snippet.get('thumbnails', {}).get('default', {}).get('url'),
                    'Date Published': snippet['publishedAt'],
                    'Channel Name': clean_for_excel(channel_name or snippet['channelTitle'])
                })
            
            next_page_token = response.get('nextPageToken')
            if not next_page_token:
                break
                
        # --- PHẦN LẤY VIEWS VÀ LỌC SHORTS ---
        # YouTube API cho phép lấy views của 50 video 1 lúc, rất nhanh
        # Chúng ta lấy thêm contentDetails để kiểm tra thời lượng (duration)
        filtered_videos = []
        for i in range(0, len(videos), 50):
            batch = videos[i:i+50]
            v_ids = ",".join([v['id'] for v in batch])
            v_res = youtube.videos().list(part="statistics,contentDetails", id=v_ids).execute()
            
            stats_map = {item['id']: item for item in v_res.get('items', [])}
            for v in batch:
                item_data = stats_map.get(v['id'])
                if item_data:
                    duration = item_data['contentDetails'].get('duration', '')
                    duration_sec = parse_duration(duration)
                    
                    # LỌC: Chỉ lấy video có thời lượng > 180 giây (thường là video dài)
                    if duration_sec <= 180:
                        continue
                        
                    v['Views'] = int(item_data['statistics'].get('viewCount', 0))
                    filtered_videos.append(v)
                    
        return filtered_videos

    except Exception as e:
        print(f"❌ Lỗi khi lấy videos từ playlist {playlist_id}: {e}")
        
    return []

def process_channel_batch(channel):
    """Xử lý từng kênh: Tìm ID -> Lấy Videos"""
    if not API_KEY:
        return []
        
    youtube = build("youtube", "v3", developerKey=API_KEY)
    ch_id, uploads_id = get_channel_id_and_uploads_id(youtube, channel['url'])
    
    if uploads_id:
        print(f"▶ Đang lấy dữ liệu từ: {channel['url']} (Uploads ID: {uploads_id})")
        return get_all_videos_from_playlist(youtube, uploads_id, channel['name'])
    else:
        print(f"⚠️ Không tìm thấy uploads playlist cho: {channel['url']}")
        return []

def main():
    if not API_KEY:
        print("❌ Lỗi: Bạn chưa cung cấp YOUTUBE_API_KEY trong file .env hoặc trong code.")
        print("Vui lòng lấy API Key tại https://console.cloud.google.com/ và thêm vào .env")
        return

    print(f"Đang đọc dữ liệu từ {FILE_PATH}...")
    try:
        wb = openpyxl.load_workbook(FILE_PATH)
    except Exception as e:
        print(f"Lỗi đọc file {FILE_PATH}. Vui lòng đóng file Excel trước khi chạy. Chi tiết: {e}")
        return

    if CHANNEL_LIST_SHEET not in wb.sheetnames:
        print(f"Lỗi: Không tìm thấy sheet '{CHANNEL_LIST_SHEET}'")
        return
        
    channel_ws = wb[CHANNEL_LIST_SHEET]
    columns = {str(cell.value).strip(): idx for idx, cell in enumerate(channel_ws[1], start=1) if cell.value}
    link_col = columns.get('Link kênh')
    name_col = columns.get('Tên kênh')
    
    if not link_col:
        print("Lỗi: Không tìm thấy cột 'Link kênh' trong sheet Channel Lisitng.")
        return

    channels = []
    for row in range(2, channel_ws.max_row + 1):
        link = channel_ws.cell(row=row, column=link_col).value
        name = channel_ws.cell(row=row, column=name_col).value if name_col else None
        if link and 'youtube' in str(link).lower():
            channels.append({'url': str(link).strip(), 'name': name})
            
    print(f"Tìm thấy {len(channels)} kênh để quét video.")

    # Kiểm tra hoặc tạo cache sheet
    if CACHE_SHEET not in wb.sheetnames:
        wb.create_sheet(CACHE_SHEET)
        
    cache_ws = wb[CACHE_SHEET]
    cache_cols = {str(cell.value).strip(): idx for idx, cell in enumerate(cache_ws[1], start=1) if cell.value}
    
    required_cache_cols = ['Title', 'URL', 'Views', 'Thumbnail', 'Caption', 'Summary', 'Date Published', 'Channel Name']
    for c in required_cache_cols:
        if c not in cache_cols:
            new_col_idx = len(cache_cols) + 1
            cache_ws.cell(row=1, column=new_col_idx).value = c
            cache_cols[c] = new_col_idx

    existing_urls = {}
    url_col_idx = cache_cols['URL']
    for row in range(2, cache_ws.max_row + 1):
        url_val = cache_ws.cell(row=row, column=url_col_idx).value
        if url_val:
            existing_urls[str(url_val).strip()] = row

    all_videos = []
    print(f"Khởi tạo YouTube API v3 và lấy dữ liệu...")
    
    # Do API Quota bị giới hạn, việc dùng threads có thể nhanh hơn nhưng cần cân nhắc Quota
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [executor.submit(process_channel_batch, ch) for ch in channels]
        for future in concurrent.futures.as_completed(futures):
            res = future.result()
            if res:
                all_videos.extend(res)

    print(f"\nTổng cộng đã lấy được {len(all_videos)} videos từ tất cả các kênh bằng API.")

    print("Đang cập nhật vào Excel...")
    added_count = 0
    updated_count = 0
    
    for vid in all_videos:
        vid_url = vid['URL']
        row_idx = existing_urls.get(vid_url)
        
        if row_idx:
            cache_ws.cell(row=row_idx, column=cache_cols['Title']).value = vid['Title']
            cache_ws.cell(row=row_idx, column=cache_cols['Views']).value = vid['Views']
            cache_ws.cell(row=row_idx, column=cache_cols['Thumbnail']).value = vid['Thumbnail']
            # Chuyển đổi định dạng ngày nếu cần, ở đây giữ nguyên string ISO từ API
            cache_ws.cell(row=row_idx, column=cache_cols['Date Published']).value = vid['Date Published']
            cache_ws.cell(row=row_idx, column=cache_cols['Channel Name']).value = vid['Channel Name']
            updated_count += 1
        else:
            row_idx = cache_ws.max_row + 1
            cache_ws.cell(row=row_idx, column=cache_cols['Title']).value = vid['Title']
            cache_ws.cell(row=row_idx, column=cache_cols['URL']).value = vid['URL']
            cache_ws.cell(row=row_idx, column=cache_cols['Views']).value = vid['Views']
            cache_ws.cell(row=row_idx, column=cache_cols['Thumbnail']).value = vid['Thumbnail']
            cache_ws.cell(row=row_idx, column=cache_cols['Date Published']).value = vid['Date Published']
            cache_ws.cell(row=row_idx, column=cache_cols['Channel Name']).value = vid['Channel Name']
            existing_urls[vid_url] = row_idx
            added_count += 1
            
    print(f"Đã cập nhật {updated_count} videos, thêm mới {added_count} videos.")
    print("Đang lưu file data.xlsx. Vui lòng chờ...")
    try:
        wb.save(FILE_PATH)
        print("✅ Đã lưu thành công!")
    except Exception as e:
        print(f"❌ Lỗi không thể lưu file: {e}. Vui lòng thử đóng Excel và chạy lại.")

if __name__ == "__main__":
    main()
