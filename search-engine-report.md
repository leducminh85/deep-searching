# Báo cáo chi tiết Search Engine hiện tại - Deep Video Search

Ngày lập báo cáo: 27/07/2026
Phạm vi: tính năng tìm kiếm trên trang public chính của project Next.js, bao gồm keyword search, AI topic search, autocomplete, filter, sort, pagination, caption search, usage profile và backend PostgreSQL FTS.

## 1. Tóm tắt kiến trúc

Search engine hiện tại là một hệ thống tìm kiếm video dựa trên PostgreSQL Full-Text Search, chạy trong Next.js App Router.

Luồng tổng quát:

```txt
User trên trang /
  -> HomePageClient.jsx
  -> DataTable.jsx
  -> GET /api/data
  -> queryVideos() trong src/lib/localDb.js
  -> PostgreSQL local table videos
  -> trả data + total về UI
```

Các nguồn dữ liệu chính:

- Video data nằm trong PostgreSQL local, bảng `videos`.
- Authentication vẫn dùng Supabase Auth.
- Search history ghi về Supabase, bảng `search_history`.
- Channel visibility/status lấy từ `channel_sources`.
- Usage profile và danh sách video đã dùng nằm trong PostgreSQL local, các bảng `usage_profiles`, `profile_used_videos`, `profile_doc_syncs`, `usage_user_settings`.
- AI topic search gọi Ollama qua HTTP API local.

Các file quan trọng:

- `nextjs-app/src/app/page.js`: server component khởi tạo dữ liệu ban đầu.
- `nextjs-app/src/app/HomePageClient.jsx`: state tổng cho theme, search mode, caption search, profile.
- `nextjs-app/src/components/DataTable.jsx`: UI search chính, tag input, AI topic button, autocomplete, filter, table render.
- `nextjs-app/src/app/api/data/route.js`: API tìm kiếm chính.
- `nextjs-app/src/app/api/search/topic/route.js`: API sinh bộ keyword nâng cao từ chủ đề bằng AI.
- `nextjs-app/src/app/api/suggestions/route.js`: API autocomplete realtime.
- `nextjs-app/src/app/api/suggestions/preload/route.js`: API preload index autocomplete.
- `nextjs-app/src/lib/localDb.js`: query builder, FTS builder, filter, pagination, suggestions.
- `docker/init.sql`: schema chuẩn cho bảng `videos`, generated `tsvector`, GIN indexes.

## 2. Data model phục vụ tìm kiếm

### 2.1. Bảng `videos`

Schema chuẩn nằm trong `docker/init.sql`.

Các cột dữ liệu video chính:

| Cột | Kiểu | Vai trò trong search |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | định danh nội bộ |
| `title` | `TEXT` | được index trong FTS |
| `url` | `TEXT UNIQUE NOT NULL` | link video, dùng dedupe |
| `channel_name` | `TEXT` | được index trong FTS, dùng filter/channel hide |
| `views` | `INTEGER` | filter/sort theo lượt xem |
| `date_published` | `TIMESTAMPTZ` | filter/sort theo ngày đăng |
| `thumbnail` | `TEXT` | render UI |
| `caption` | `TEXT` | chỉ tìm khi bật caption search |
| `summary` | `TEXT` | phân tích video, được index trong FTS |
| `video_key` | `TEXT` | nhận diện video khi so với usage profile |
| `created_at` | `TIMESTAMPTZ` | sort mặc định ở một số API |

### 2.2. Cột Full-Text Search generated

PostgreSQL tạo sẵn 2 cột `tsvector`:

```sql
fts TSVECTOR GENERATED ALWAYS AS (
    to_tsvector(
        'simple',
        coalesce(title, '') || ' ' ||
        coalesce(summary, '') || ' ' ||
        coalesce(caption, '') || ' ' ||
        coalesce(channel_name, '')
    )
) STORED
```

`fts` dùng khi bật tìm trong caption.

```sql
fts_no_caption TSVECTOR GENERATED ALWAYS AS (
    to_tsvector(
        'simple',
        coalesce(title, '') || ' ' ||
        coalesce(summary, '') || ' ' ||
        coalesce(channel_name, '')
    )
) STORED
```

`fts_no_caption` dùng khi không bật caption search.

Lưu ý quan trọng:

- Config FTS đang dùng `'simple'`, không dùng English stemming.
- Từ khóa được token hóa khá trực tiếp, phù hợp tìm keyword chính xác.
- Vì dùng `simple`, các biến thể như `arrest`, `arrested`, `arresting` không tự normalize về cùng gốc. Do đó AI topic search cần sinh thêm các biến thể gần nghĩa hoặc gần hình thái nếu cần.
- Caption có thể làm tập tìm kiếm rộng hơn rất nhiều, nhưng cũng có thể làm query chậm/nhiễu hơn nếu caption dài.

### 2.3. Index phục vụ search

Trong `docker/init.sql` có các index:

```sql
CREATE INDEX IF NOT EXISTS idx_videos_fts ON videos USING GIN(fts);
CREATE INDEX IF NOT EXISTS idx_videos_fts_no_caption ON videos USING GIN(fts_no_caption);
```

Các index phụ:

```sql
CREATE INDEX IF NOT EXISTS idx_videos_url ON videos(url);
CREATE INDEX IF NOT EXISTS idx_videos_channel_name ON videos(channel_name);
CREATE INDEX IF NOT EXISTS idx_videos_views ON videos(views);
CREATE INDEX IF NOT EXISTS idx_videos_date_published ON videos(date_published);
CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at);
CREATE INDEX IF NOT EXISTS idx_videos_video_key ON videos(video_key);
```

## 3. Luồng render ban đầu

File: `nextjs-app/src/app/page.js`

Khi user vào `/`, server component:

1. Tạo Supabase server client.
2. Gọi `supabase.auth.getUser()`.
3. Nếu có user:
   - lấy active usage profile bằng `getActiveProfile(user.email)`;
   - gọi `getDataInternal()` để lấy page đầu tiên.
4. Truyền `initialData` và `initialProfile` xuống `HomePageClient`.

Default query ban đầu:

```txt
page = 1
pageSize = 50
sortBy = date_published
sortOrder = desc
mode = or
query = null
captionSearch = true
hideUsed = Boolean(initialProfile)
```

Điểm đáng chú ý:

- Lần load đầu có SSR data nếu user đã login.
- Nếu có active profile, mặc định ẩn video đã dùng.
- Mặc định server initial đang bật `captionSearch = true`, còn client state `captionSearchEnabled` ban đầu là `false` rồi load từ localStorage. Điều này có thể tạo khác biệt nhỏ giữa dữ liệu SSR lần đầu và lần fetch sau trên client.

## 4. UI search trên frontend

File chính: `nextjs-app/src/components/DataTable.jsx`

### 4.1. State chính

Các state liên quan trực tiếp đến search:

```txt
searchTags              tag keyword người dùng đang nhập/tạo
appliedTags             tag đã được apply để fetch
appliedAdvancedSearch   query plan AI đang được apply
inputValue              text trong ô input
searchMode              OR/AND, truyền từ HomePageClient
captionSearchEnabled    bật/tắt tìm trong caption
appliedFilters          filter đã áp dụng
sortConfig              sort hiện tại
page                    page hiện tại
totalResults            tổng số kết quả backend trả về
hasMore                 còn data để load thêm hay không
loading/loadingMore     trạng thái tải
error                   lỗi fetch
```

### 4.2. Keyword input dạng tag

Người dùng nhập trong `.search-input`.

Hành vi:

- Nhấn dấu phẩy `,`: tạo tag từ `inputValue`, nhưng chưa search.
- Nhấn `Enter`: nếu đang chọn autocomplete thì chọn suggestion, nếu không thì apply search.
- Nhấn nút Search icon: apply search.
- Backspace khi input rỗng: xóa tag cuối khỏi danh sách tag đang nhập.
- Xóa tag bằng nút `×` trên tag: chỉ xóa khỏi `searchTags`, chưa tự refetch vì code comment ghi rõ chỉ search khi Enter/Icon.

Khi `handleSearch()` chạy:

1. Nếu input còn text, thêm text đó thành tag.
2. `setAppliedTags(newTags)`.
3. Tắt advanced search bằng `setAppliedAdvancedSearch(null)`.
4. Reset page về 1.
5. Đóng autocomplete.

### 4.3. Toggle OR/AND

Nút mode hiển thị `OR` hoặc `AND`.

State nằm trong `HomePageClient`:

```txt
searchMode = 'or' | 'and'
```

Nút toggle gọi `onToggleSearchMode`.

Ý nghĩa:

- `OR`: video khớp ít nhất một tag.
- `AND`: video phải khớp tất cả tag.

Lưu ý hiện tại:

- Toggle mode không tự fetch nếu dependency effect không đổi theo `searchMode`.
- Trong `DataTable.jsx`, `useEffect` fetch phụ thuộc vào `appliedTags`, `appliedAdvancedSearch`, `page`, `sortConfig`, `appliedFilters`, `captionSearchEnabled`, `usageFilterKey`, nhưng không có `searchMode`.
- Vì vậy đổi OR/AND sau khi đã search có thể không tự refetch cho đến khi người dùng search lại hoặc đổi yếu tố khác. Tour cũng mô tả đúng: đổi nút này không tự fetch lại dữ liệu.

### 4.4. AI topic button

Nút `AI chủ đề` nằm cạnh nút search.

Luồng:

```txt
inputValue hoặc searchTags
  -> POST /api/search/topic
  -> AI/Ollama sinh plan
  -> setSearchTags(terms)
  -> setAppliedTags(terms)
  -> setAppliedAdvancedSearch({ topic, displayQuery, plan, warning })
  -> fetchData(..., mode='advanced', advancedQuery=plan)
```

UI hiển thị một dải summary:

```txt
Tìm nâng cao bằng AI
(airport OR airplane OR flight OR passenger) AND (karen OR woman OR girl)
```

Nút `Tắt` trong summary:

- set `appliedAdvancedSearch = null`;
- clear error;
- reset page 1;
- quay lại keyword search thường theo `appliedTags`/`searchMode`.

### 4.5. Caption search toggle

Nút icon `Captions` nằm ở header trong `HomePageClient`.

State:

```txt
captionSearchEnabled = true | false
```

Khi bật:

- API nhận `caption_search=1`.
- Backend dùng cột `fts`.

Khi tắt:

- API nhận `caption_search=0`.
- Backend dùng cột `fts_no_caption`.

State được lưu vào `localStorage` key `captionSearchEnabled`.

### 4.6. Highlight keyword

Component `Highlight` trong `DataTable.jsx` highlight các từ đang search trong cell.

Cách làm:

- Lấy danh sách search terms.
- Sort theo độ dài giảm dần.
- Escape regex.
- Match không phân biệt hoa/thường.
- Có hỗ trợ remove accent khi so sánh để tăng khả năng match tiếng Việt.

Lưu ý:

- Highlight là UI-only, không ảnh hưởng backend search.
- Với AI advanced search, `searchTags` được set bằng toàn bộ terms AI trả về, nên highlight vẫn dùng các keyword đó.

## 5. API tìm kiếm chính `/api/data`

File: `nextjs-app/src/app/api/data/route.js`

Method: `GET`

### 5.1. Auth

API yêu cầu user đã login Supabase:

```txt
supabase.auth.getUser()
```

Nếu không có user hoặc auth error:

```json
{ "error": "Unauthorized" }
```

Status: `401`

### 5.2. Query parameters

| Param | Ví dụ | Ý nghĩa |
|---|---|---|
| `q` | `airport,karen` | chuỗi keyword/tag, ngăn cách bằng dấu phẩy |
| `page` | `1` | trang hiện tại |
| `size` | `50` | số item/trang, max 100 |
| `sort` | `date_published` | cột sort |
| `order` | `desc` | hướng sort |
| `mode` | `or`, `and`, `advanced` | search mode |
| `advanced_query` | JSON encoded | AI plan cho advanced search |
| `min_views` | `10000` | filter views tối thiểu |
| `max_views` | `500000` | filter views tối đa |
| `start_date` | `2025-01-01` | filter ngày đăng từ |
| `end_date` | `2025-12-31` | filter ngày đăng đến |
| `channels` | `A,B,C` | chỉ lấy các kênh được chọn |
| `caption_search` | `1` hoặc `0` | bật/tắt tìm trong caption |
| `profile_id` | `12` | usage profile đang active |
| `hide_used` | `1` hoặc `0` | ẩn video đã dùng |

### 5.3. Page size guard

Backend giới hạn:

```txt
pageSize = Math.min(rawSize, 100)
```

Điểm tốt:

- Tránh client kéo quá nhiều dữ liệu trong một request.

Điểm còn thiếu:

- Chưa clamp page tối thiểu.
- Chưa reject sort/order invalid ở API layer, nhưng `localDb.js` có whitelist sort column.

### 5.4. Response

Thành công:

```json
{
  "data": [],
  "total": 123,
  "page": 1,
  "page_size": 50
}
```

Lỗi query DB:

```json
{
  "detail": "error message",
  "data": [],
  "total": 0
}
```

Status: `500`

### 5.5. Search history

Nếu là page 1 và `query` có text:

```txt
logSearchHistory(supabase, query, mode, total, user.email)
```

Ghi vào Supabase `search_history`:

```txt
full_query
keywords
search_mode
results_count
user_email
```

Lưu ý:

- Advanced search hiện ghi `full_query` là `displayQuery`.
- `keywords` được split bằng dấu phẩy. Với `displayQuery` advanced dạng `(airport OR flight) AND (karen OR woman)`, mảng `keywords` có thể không đẹp vì không còn comma-separated. Nếu cần analytics chính xác, nên log thêm `advanced_plan` hoặc format `keywords` từ `terms`.

## 6. Query builder trong `localDb.js`

File: `nextjs-app/src/lib/localDb.js`

Function chính:

```js
queryVideos({ query, page, pageSize, sortBy, sortOrder, mode, filters..., advancedQuery })
```

### 6.1. Kết nối database

`getPool()` tạo PostgreSQL pool bằng:

```txt
process.env.LOCAL_DATABASE_URL
```

Nếu không có, fallback:

```txt
POSTGRES_USER
POSTGRES_PASSWORD
POSTGRES_HOST
POSTGRES_PORT
POSTGRES_APP_DB hoặc POSTGRES_DB
```

Default:

```txt
postgresql://postgres:postgres@localhost:5432/deep_searching
```

### 6.2. Schema phụ cho usage profile

Mỗi lần `queryVideos()` chạy sẽ gọi:

```txt
ensureUsageSchema()
```

Function này đảm bảo tồn tại:

- `video_key` column trên `videos`;
- index `idx_videos_video_key`;
- bảng `usage_profiles`;
- bảng `profile_used_videos`;
- bảng `profile_doc_syncs`;
- bảng `usage_user_settings`;
- các index liên quan.

Lưu ý:

- `ensureUsageSchema()` không tạo `fts`/`fts_no_caption`. Hai cột này được tạo trong `docker/init.sql`. Nếu database được tạo bằng script khác không có 2 generated columns này, search sẽ lỗi.

### 6.3. Hidden channel filter

Mọi query video đều thêm điều kiện:

```sql
NOT EXISTS (
    SELECT 1
    FROM channel_sources cs
    WHERE cs.hidden IS TRUE
      AND lower(cs.channel_name) = lower(videos.channel_name)
)
```

Ý nghĩa:

- Kênh bị ẩn trong `channel_sources` sẽ không xuất hiện ở public search.

### 6.4. Sort whitelist

Sort column được map bằng `columnMap`:

```txt
title -> title
url -> url
views -> views
date_published -> date_published
channel_name -> channel_name
created_at -> created_at
thumbnail -> thumbnail
summary -> summary
```

Nếu client gửi sort lạ, fallback:

```txt
created_at
```

Order:

```txt
desc nếu sortOrder lowercase là desc
ngược lại asc
```

Điểm tốt:

- Tránh SQL injection qua tên cột sort.

### 6.5. Keyword search thường

Input UI:

```txt
airport,karen,woman
```

Backend flow:

1. Sanitize query:

```js
query.trim().replace(/[^\p{L}\p{N}\s,]/gu, '')
```

2. Split bằng dấu phẩy:

```txt
["airport", "karen", "woman"]
```

3. Mỗi tag chuyển thành tsquery:

- Một từ: `airport`
- Nhiều từ: `(sovereign <-> citizen)`

4. Join theo mode:

- `mode=or`: `airport | karen | woman`
- `mode=and`: `airport & karen & woman`

5. Query DB:

```sql
fts_column @@ to_tsquery('simple', $param)
```

Trong đó `fts_column` là:

- `fts` nếu `captionSearch = true`;
- `fts_no_caption` nếu `captionSearch = false`.

### 6.6. Phrase behavior với `<->`

Nếu tag có nhiều từ, ví dụ:

```txt
sovereign citizen
```

Backend build:

```txt
(sovereign <-> citizen)
```

Ý nghĩa:

- Hai token phải đứng sát nhau theo thứ tự trong `tsvector`.

Ưu điểm:

- Tốt cho entity exact phrase như `sovereign citizen`.

Nhược điểm:

- Quá chặt với cụm dài tự nhiên như `airport karen meltdown`.
- Nếu summary/caption dùng wording khác, có thể miss.

### 6.7. AI advanced search

Advanced search dùng plan JSON, không dùng raw SQL hoặc raw tsquery từ client.

Plan mẫu:

```json
{
  "rootOperator": "AND",
  "groups": [
    {
      "operator": "OR",
      "terms": ["airport", "airplane", "flight", "passenger"]
    },
    {
      "operator": "OR",
      "terms": ["karen", "woman", "girl"]
    }
  ]
}
```

Backend normalize bằng:

```txt
normalizeAdvancedSearchPlan()
```

Giới hạn:

```txt
MAX_ADVANCED_GROUPS = 6
MAX_ADVANCED_TERMS_PER_GROUP = 8
MAX_ADVANCED_TERM_LENGTH = 64
```

Sanitize term:

```js
replace(/[^\p{L}\p{N}\s]/gu, ' ')
```

Operator chỉ nhận:

```txt
AND | OR
```

Nếu operator invalid sẽ fallback về operator mặc định.

### 6.8. Advanced tsquery strict

Function:

```txt
buildAdvancedSearchTsQuery(plan)
```

Ví dụ Karen sân bay:

```txt
(airport | airplane | flight | passenger) & (karen | woman | girl)
```

Ví dụ sovereign citizen:

```txt
((sovereign <-> citizen) | sovereign | freeman) & (arrested | arrest | police | detained)
```

### 6.9. Advanced relaxed fallback

Function:

```txt
buildRelaxedAdvancedSearchTsQuery(plan)
```

Khi strict query trả `totalCount = 0`, backend tự chạy lại bằng query relaxed nếu có.

Relaxed vẫn giữ cấu trúc nhóm.

Ví dụ:

Strict:

```txt
((sovereign <-> citizen) | sovereign | freeman) & (arrested | arrest | police | detained)
```

Relaxed:

```txt
((sovereign <-> citizen) | sovereign | citizen | freeman) & (arrested | arrest | police | detained)
```

Điểm quan trọng:

- Fallback không bung toàn bộ thành `OR`.
- Vẫn yêu cầu match ít nhất một term trong mỗi facet group.
- Giảm tình trạng 0 kết quả nhưng vẫn giữ intent của chủ đề.

### 6.10. Count query và data query

Backend chạy 2 query:

1. Count:

```sql
SELECT COUNT(*) as total FROM videos WHERE ...
```

2. Data:

```sql
SELECT title, url, channel_name, views, date_published, thumbnail,
       created_at, summary, video_key, channel_status, is_used
FROM videos
WHERE ...
ORDER BY ...
LIMIT ...
OFFSET ...
```

### 6.11. Channel status trong result

Data query thêm:

```sql
COALESCE((
    SELECT cs.status
    FROM channel_sources cs
    WHERE lower(btrim(cs.channel_name)) = lower(btrim(videos.channel_name))
    ORDER BY CASE WHEN cs.status = 'copyright' THEN 0 ELSE 1 END
    LIMIT 1
), 'normal') AS channel_status
```

Ý nghĩa:

- Nếu channel có status `copyright`, ưu tiên trả status này.
- Nếu không có status, fallback `normal`.

### 6.12. Usage profile filter

Nếu có `profileId` và `userEmail`:

- Nếu `hideUsed=true`, thêm điều kiện `NOT EXISTS`.
- Nếu `hideUsed=false`, vẫn select thêm `is_used` để UI biết video đã dùng.

Match video đã dùng bằng:

```txt
video_key hoặc url
```

Có join với `usage_profiles` để đảm bảo profile thuộc đúng user email.

## 7. AI topic search

File: `nextjs-app/src/app/api/search/topic/route.js`

### 7.1. Mục tiêu

Tính năng này cho phép user nhập một chủ đề tự nhiên, ví dụ:

```txt
các vụ việc karen gây rối ở sân bay
```

AI sẽ chuyển thành bộ keyword có cấu trúc:

```txt
(airport OR airplane OR flight OR passenger)
AND
(karen OR woman OR girl)
```

Mục tiêu không phải sinh nhiều keyword phức tạp, mà là bóc ra các tín hiệu tìm kiếm chính:

- Đối tượng/thực thể.
- Địa điểm/bối cảnh/vật thể.
- Hành động đặc trưng nếu cần.
- Từ đồng nghĩa/gần nghĩa với từng facet.

### 7.2. Auth

Giống `/api/data`, route yêu cầu Supabase user:

```txt
supabase.auth.getUser()
```

Không login thì trả `401`.

### 7.3. Request

Method:

```txt
POST /api/search/topic
```

Body:

```json
{
  "topic": "các vụ việc karen gây rối ở sân bay"
}
```

Giới hạn:

```txt
MAX_TOPIC_LENGTH = 240
```

Topic dưới 2 ký tự sẽ bị reject.

### 7.4. Ollama config

Base URL:

```txt
OLLAMA_BASE_URL
OLLAMA_HOST
http://localhost:11434
```

Model:

```txt
SEARCH_OLLAMA_MODEL
OLLAMA_MODEL
V3_OLLAMA_MODEL
qwen2.5:7b
```

Timeout:

```txt
30000ms
```

Ollama endpoint:

```txt
POST /api/chat
```

Options:

```json
{
  "temperature": 0.2,
  "top_p": 0.9,
  "num_predict": 700
}
```

### 7.5. Prompt hiện tại

Prompt yêu cầu AI:

- Chỉ trả JSON hợp lệ.
- Schema:

```json
{
  "rootOperator": "AND",
  "groups": [
    {
      "operator": "OR",
      "terms": ["term"]
    }
  ]
}
```

- Chỉ extract core searchable keyword facets:
  - subject/person/entity;
  - location/object/context;
  - distinctive action nếu quan trọng.
- Mỗi group là một facet.
- Trong group dùng `OR` cho các từ gần nghĩa.
- Dùng `rootOperator = AND` khi có từ 2 facet bắt buộc trở lên.
- Chỉ giữ key nouns, named phrases, locations, objects, roles, concrete actions.
- Term tối đa 1-2 từ.
- Giữ exact phrase 2 từ quan trọng như `sovereign citizen`.
- Tránh từ chung chung:
  - `video`
  - `viral`
  - `incident`
  - `case`
  - `story`
  - `public`
  - `compilation`
  - `caught on camera`
  - `people`
- Ưu tiên common English search terms.

Prompt có 2 ví dụ hard-coded:

```json
{
  "rootOperator": "AND",
  "groups": [
    {
      "operator": "OR",
      "terms": ["airport", "airplane", "flight", "passenger"]
    },
    {
      "operator": "OR",
      "terms": ["karen", "woman", "girl"]
    }
  ]
}
```

```json
{
  "rootOperator": "AND",
  "groups": [
    {
      "operator": "OR",
      "terms": ["sovereign citizen", "sovereign", "freeman"]
    },
    {
      "operator": "OR",
      "terms": ["arrested", "arrest", "police", "detained"]
    }
  ]
}
```

### 7.6. JSON parsing

Route có `extractJsonObject(text)`:

- Nếu AI trả markdown fenced block, lấy phần trong ```json.
- Nếu AI trả kèm text thừa, lấy từ `{` đầu tiên đến `}` cuối cùng.
- Parse JSON.

Điểm tốt:

- Chịu được output không hoàn toàn sạch.

Rủi ro:

- Nếu AI trả nhiều object hoặc text có `{}` không liên quan, parser có thể lấy sai.
- Nhưng sau parse vẫn qua `normalizeAdvancedSearchPlan()`, nên payload không đúng schema sẽ bị loại.

### 7.7. Fallback khi Ollama lỗi

Nếu Ollama không chạy hoặc lỗi:

```txt
fallbackPlan(topic)
```

Fallback có hint groups cho một số case:

- Karen:

```txt
karen OR woman OR girl
```

- Sân bay/chuyến bay:

```txt
airport OR airplane OR flight OR passenger
```

- Sovereign citizen:

```txt
sovereign citizen OR sovereign OR freeman
```

- Bị bắt/cảnh sát:

```txt
arrested OR arrest OR police OR detained
```

- Gây rối/meltdown/argument:

```txt
disturbance OR meltdown OR argument
```

Nếu không match hint nào, fallback:

- remove accent;
- lower case;
- tách token;
- bỏ generic words;
- lấy tối đa 8 từ;
- tạo một group OR.

Response fallback có `warning`.

### 7.8. Response

Ví dụ response:

```json
{
  "topic": "các vụ việc karen gây rối ở sân bay",
  "plan": {
    "rootOperator": "AND",
    "groups": [
      {
        "operator": "OR",
        "terms": ["airport", "airplane", "flight", "passenger"]
      },
      {
        "operator": "OR",
        "terms": ["karen", "woman", "girl"]
      }
    ]
  },
  "terms": ["airport", "airplane", "flight", "passenger", "karen", "woman", "girl"],
  "displayQuery": "(airport OR airplane OR flight OR passenger) AND (karen OR woman OR girl)",
  "model": "qwen2.5:7b",
  "warning": null
}
```

## 8. Autocomplete / suggestions

### 8.1. Preload local suggestion index

Frontend khi mount gọi:

```txt
GET /api/suggestions/preload
```

Route:

```txt
nextjs-app/src/app/api/suggestions/preload/route.js
```

Auth:

- Yêu cầu Supabase user.

Backend:

```txt
preloadSuggestionIndex()
```

SQL:

```sql
SELECT word, nentry
FROM ts_stat('SELECT fts_no_caption FROM videos')
WHERE length(word) >= 2
ORDER BY nentry DESC
LIMIT 2000
```

Cache:

- Server memory cache 5 phút.
- Browser cache `private, max-age=300`.

Frontend giữ trong:

```txt
localIndexRef.current
seenSuggestionsRef.current
```

### 8.2. Instant local filtering

Khi user nhập:

```txt
filterLocal(value)
```

Logic:

- lowercase input;
- match prefix với `index.keywords`;
- trả tối đa 12 item.

Ưu điểm:

- Gần như tức thì.
- Không cần gọi API nếu local đã đủ.

### 8.3. API suggestions realtime

Sau 200ms debounce, frontend gọi:

```txt
GET /api/suggestions?q=...
```

Route:

```txt
nextjs-app/src/app/api/suggestions/route.js
```

Backend:

```txt
getSuggestions(query)
```

SQL:

```sql
SELECT word, nentry
FROM ts_stat('SELECT fts_no_caption FROM videos')
WHERE word LIKE $1 AND length(word) >= 2
ORDER BY nentry DESC
LIMIT 12
```

Cache:

- Client-side `Map`, tối đa 100 query.
- API response `Cache-Control: private, max-age=5`.

### 8.4. Điểm cần lưu ý về suggestions

- Suggestions chỉ lấy từ `fts_no_caption`, không lấy từ caption.
- Suggestions hiện chỉ match prefix, không fuzzy.
- Vì dùng `ts_stat`, query có thể nặng nếu DB lớn, nhưng preload có cache 5 phút và realtime limit 12.
- `ts_stat('SELECT fts_no_caption FROM videos')` scan lexeme thống kê từ toàn bộ tsvector; với dữ liệu rất lớn nên cân nhắc materialized table/cache riêng.

## 9. Filter, sort, pagination

### 9.1. Filters frontend

Filter sidebar hỗ trợ:

- Min views.
- Max views.
- Start date.
- End date.
- Selected channels.

User bấm `Áp dụng bộ lọc` thì:

```txt
setAppliedFilters(filters)
setPage(1)
```

Clear filter:

- reset view/date/channel;
- clear applied tags;
- clear search tags;
- clear AI advanced search;
- page về 1.

### 9.2. Filters backend

Backend thêm SQL condition:

```sql
views >= $param
views <= $param
date_published >= $param
date_published <= $param
channel_name = ANY($param)
```

Channel filter chỉ gửi nếu:

```txt
selectedChannels.length > 0
selectedChannels.length < availableChannels.length
```

Nếu chọn tất cả channel thì không gửi filter, để query đơn giản hơn.

### 9.3. Sort

Frontend sort table header:

- click header để đổi sort key;
- click lần nữa đổi asc/desc;
- reset page về 1.

Backend sort bằng whitelist trong `columnMap`, tránh injection.

Default backend `/api/data`:

```txt
sort = Created At
order = desc
```

Default SSR page:

```txt
sortBy = date_published
sortOrder = desc
```

### 9.4. Pagination / load more

Frontend:

- `pageSize = 50`.
- Khi page 1: clear data, loading progress.
- Khi load more: append data.
- `hasMore = newData.length === pageSize`.
- `visibleRows` tăng thêm khi có data mới.

Backend:

```txt
offset = (page - 1) * pageSize
LIMIT pageSize OFFSET offset
```

Rủi ro:

- OFFSET pagination có thể chậm khi page rất sâu.
- Nếu dataset lớn và user scroll sâu, nên cân nhắc keyset pagination theo `date_published/id`.

## 10. Security hiện tại

### 10.1. Auth guard

Các search API chính đều yêu cầu Supabase user:

- `/api/data`
- `/api/suggestions`
- `/api/suggestions/preload`
- `/api/search/topic`

### 10.2. SQL injection protection

Điểm tốt:

- Values đều truyền qua parameter `$1`, `$2`, ...
- Sort column có whitelist.
- Search terms được sanitize, chỉ giữ letter/number/space/comma ở keyword search.
- Advanced search không nhận raw tsquery từ client, chỉ nhận JSON plan rồi server tự build.
- Advanced plan giới hạn số nhóm, số term, độ dài term.

Điểm cần chú ý:

- `advanced_query` truyền qua query string. Nếu plan lớn, URL có thể dài. Hiện đã giới hạn plan nhưng nếu sau này tăng kích thước nên chuyển `/api/data` sang POST cho advanced search.
- `to_tsquery` có thể throw nếu tsquery malformed. Hiện builder kiểm soát khá kỹ, nhưng với unicode/token lạ vẫn nên có test case.

### 10.3. Data exposure

API trả:

- title;
- url;
- channel;
- views;
- date;
- thumbnail;
- summary;
- video_key;
- channel_status;
- used flag.

Không trả caption trực tiếp trong search result.

### 10.4. Ollama safety

AI route:

- Không truyền secret cho client.
- Chỉ gọi Ollama từ server.
- Có timeout 30s.
- Có fallback nếu Ollama lỗi.
- Output AI được normalize trước khi đưa vào search.

Rủi ro:

- Prompt injection từ topic user có thể làm AI trả output sai schema, nhưng parser/normalizer giảm tác động.
- Nếu Ollama chậm, request giữ 30s. Có thể cần UI timeout hoặc queue nếu nhiều user.

## 11. Performance hiện tại

### 11.1. Điểm mạnh

- Search chính dùng GIN index trên `tsvector`.
- Page size max 100.
- Sort column index có sẵn cho views/date/created_at.
- Autocomplete có preload cache 5 phút.
- Client abort request cũ khi search page 1.
- Suggestions realtime có debounce 200ms và client cache.

### 11.2. Điểm có thể tốn chi phí

- Count query chạy mỗi lần search.
- Data query chạy riêng sau count.
- Advanced strict nếu 0 kết quả sẽ chạy thêm count + data một lần nữa với relaxed query.
- `ts_stat` suggestions có thể nặng nếu DB lớn.
- OFFSET pagination chậm khi page sâu.
- Caption search dùng `fts` có caption, tsvector lớn hơn.
- Sort theo cột không liên quan relevance; hiện chưa có ranking theo `ts_rank`.

### 11.3. Khuyến nghị performance

Ưu tiên theo tác động:

1. Thêm `ts_rank` để sort relevance khi có query.
2. Chỉ count khi cần hiển thị tổng, hoặc cache count theo query/filter.
3. Materialize suggestions vào bảng riêng thay vì dùng `ts_stat` runtime.
4. Dùng keyset pagination cho infinite scroll sâu.
5. Với AI advanced fallback, có thể trả metadata `relaxed: true` để UI biết query đã được nới.

## 12. Chất lượng search hiện tại

### 12.1. Điểm mạnh

- Keyword search đơn giản, dễ hiểu.
- OR/AND mode rõ ràng.
- Hỗ trợ phrase gần nhau cho tag nhiều từ.
- Có caption toggle.
- Có filter/sort đầy đủ.
- Có AI topic search theo facet, giúp user không phải tự nghĩ keyword.
- Advanced search hiện đã tránh query quá phức tạp bằng prompt facet và relaxed fallback.

### 12.2. Hạn chế chính

#### Không có relevance ranking

Hiện result sort theo cột user chọn, không sort theo độ khớp FTS.

Ví dụ query `airport karen`:

- Video match cả title và summary không chắc lên trước.
- Video cũ/mới phụ thuộc sort hiện tại.

#### Không có stemming/synonym tự nhiên

Do dùng config `simple`:

```txt
arrest
arrested
arresting
```

có thể là 3 lexeme khác nhau.

AI phải sinh biến thể để bù.

#### Phrase `<->` có thể quá chặt

Tốt cho:

```txt
sovereign citizen
body cam
police officer
```

Không tốt cho cụm dài hoặc cụm có từ chen giữa.

#### AI topic search phụ thuộc prompt/model

Nếu model sinh term chưa tốt:

- query có thể quá rộng;
- hoặc quá hẹp;
- hoặc dùng từ không có trong dataset.

Hiện đã có fallback hint cho một vài case, nhưng chưa có feedback loop dựa trên thống kê DB.

#### Suggestions chưa hỗ trợ semantic/fuzzy

Autocomplete chỉ prefix match lexeme.

Không hỗ trợ:

- typo;
- synonyms;
- tiếng Việt không dấu -> có dấu;
- plural/singular fuzzy.

## 13. Những điểm lệch/bug tiềm năng

### 13.1. Toggle OR/AND không tự refetch

Trong `DataTable.jsx`, effect fetch không có `searchMode` trong dependency.

Hành vi hiện tại:

- User search bằng OR.
- User bấm toggle sang AND.
- Data không đổi ngay.
- User phải bấm search lại hoặc đổi filter/sort/page.

Tour hiện mô tả hành vi này, nên có thể là intentional. Nếu muốn UX tự nhiên hơn, thêm `searchMode` vào dependency và cẩn thận tránh fetch khi chưa apply.

### 13.2. Search history cho advanced chưa đẹp

Advanced query dùng `displayQuery`, nhưng `keywords` log bằng split comma.

Nên thêm:

```txt
search_mode = advanced
advanced_plan JSONB
terms TEXT[]
topic TEXT
used_relaxed BOOLEAN
```

### 13.3. `fts` columns không được ensure ở app runtime

Nếu DB không tạo từ `docker/init.sql`, `queryVideos()` sẽ lỗi vì không có `fts` hoặc `fts_no_caption`.

Nên có migration/ensure:

```sql
ALTER TABLE videos ADD COLUMN ...
CREATE INDEX ...
```

Hoặc tách migration SQL rõ ràng.

### 13.4. AI fallback không biết corpus thực tế

Fallback hard-coded có ích cho vài chủ đề, nhưng không biết dataset thật có dùng từ nào.

Nên đưa top lexeme suggestions vào prompt hoặc post-process:

- AI sinh candidate terms.
- Server check term có tồn tại trong `ts_stat`.
- Loại term không có trong corpus.
- Gợi ý alternative gần nhất.

### 13.5. Không có explain/debug query trên UI

Hiện UI hiển thị `displayQuery`, nhưng không hiển thị:

- strict hay relaxed;
- tsquery thực tế;
- group nào làm query ra 0;
- term nào không có trong corpus.

Admin/debug panel sẽ rất hữu ích khi tuning AI search.

## 14. Đánh giá theo từng loại search

### 14.1. Keyword OR

Ví dụ:

```txt
airport,karen,woman
mode=or
```

Backend:

```txt
airport | karen | woman
```

Phù hợp:

- Khám phá rộng.
- User chưa chắc keyword nào xuất hiện.

Không phù hợp:

- Chủ đề cần nhiều điều kiện cùng lúc.
- Dễ ra nhiều kết quả nhiễu.

### 14.2. Keyword AND

Ví dụ:

```txt
airport,karen
mode=and
```

Backend:

```txt
airport & karen
```

Phù hợp:

- User biết chính xác vài keyword bắt buộc.

Không phù hợp:

- Nếu một keyword không xuất hiện đúng trong corpus, kết quả về 0.

### 14.3. Phrase tag

Ví dụ:

```txt
sovereign citizen
```

Backend:

```txt
(sovereign <-> citizen)
```

Phù hợp:

- Named entity/cụm cố định.

Không phù hợp:

- Cụm mô tả dài.

### 14.4. AI topic search

Ví dụ:

```txt
các vụ karen gây rối ở sân bay
```

Plan:

```txt
(airport OR airplane OR flight OR passenger)
AND
(karen OR woman OR girl)
```

Phù hợp:

- User nhập chủ đề tự nhiên.
- Chủ đề có 2-3 facet rõ.
- Cần mix AND/OR trong cùng một bộ query.

Không phù hợp:

- Chủ đề quá trừu tượng.
- Chủ đề cần hiểu semantic sâu hơn keyword.
- Chủ đề mà corpus không có từ đồng nghĩa trực tiếp.

## 15. Đề xuất cải thiện tiếp theo

### 15.1. Thêm relevance ranking

Hiện tại search chỉ filter bằng FTS rồi sort theo cột.

Nên thêm:

```sql
ts_rank_cd(fts_column, to_tsquery('simple', $query)) AS rank
```

Khi có search query:

```txt
ORDER BY rank DESC, date_published DESC
```

Hoặc thêm sort option:

```txt
Relevance
Newest
Most views
```

### 15.2. Corpus-aware AI keyword validation

Pipeline đề xuất:

```txt
Topic
  -> AI sinh groups candidates
  -> Server check từng term trong lexeme dictionary
  -> Loại/giảm trọng số term không có
  -> Nếu group rỗng, hỏi AI sinh lại hoặc fallback bằng suggestions gần nhất
  -> Run search
```

Nguồn kiểm tra:

```sql
ts_stat('SELECT fts_no_caption FROM videos')
```

Có thể cache dictionary trong memory.

### 15.3. Trả metadata search về UI

`/api/data` nên trả thêm:

```json
{
  "search": {
    "mode": "advanced",
    "strict_total": 0,
    "relaxed": true,
    "effective_query": "(airport | airplane | flight) & (karen | woman)",
    "fts_column": "fts_no_caption"
  }
}
```

UI có thể hiển thị:

```txt
Không có kết quả strict, đã nới từ khóa nhưng vẫn giữ nhóm chính.
```

### 15.4. Tối ưu suggestions

Thay vì `ts_stat` runtime:

1. Tạo bảng:

```sql
search_terms(word TEXT PRIMARY KEY, nentry INT, updated_at TIMESTAMPTZ)
```

2. Refresh khi import/update daily.
3. API suggestions query bảng này.

### 15.5. Tách search service rõ hơn

Hiện `localDb.js` chứa:

- DB pool;
- usage schema;
- search query builder;
- suggestions;
- channels.

Nên tách:

```txt
src/lib/db/pool.js
src/lib/search/searchQueryBuilder.js
src/lib/search/videoSearch.js
src/lib/search/suggestions.js
src/lib/usage/usageSchema.js
```

Lợi ích:

- Dễ test unit cho builder.
- Dễ thay đổi FTS/relevance.
- Giảm rủi ro sửa search làm ảnh hưởng usage profile.

### 15.6. Unit tests cần có

Nên test các case:

```txt
keyword OR:
["airport", "karen"] -> airport | karen

keyword AND:
["airport", "karen"] -> airport & karen

phrase:
"sovereign citizen" -> (sovereign <-> citizen)

advanced:
airport group AND karen group -> (airport | flight) & (karen | woman)

relaxed:
sovereign citizen -> (sovereign <-> citizen) | sovereign | citizen

sanitize:
"airport'); DROP TABLE videos;--" -> airport DROP TABLE videos
```

### 15.7. Search mode UX

Hiện có 3 khái niệm:

- OR;
- AND;
- AI topic/advanced.

Nên thiết kế rõ hơn:

```txt
[Từ khóa] [Chủ đề AI]
```

Trong tab keyword:

- OR/AND toggle.

Trong tab AI:

- Input placeholder: "Nhập chủ đề, ví dụ: karen gây rối ở sân bay"
- Button: "Tạo bộ từ khóa"
- Preview editable groups:
  - Bối cảnh: airport, airplane, flight, passenger
  - Đối tượng: karen, woman, girl
  - Hành động: meltdown, argument

Cho phép user xóa/sửa term trước khi run.

## 16. Kết luận

Search engine hiện tại đã có nền khá tốt:

- PostgreSQL FTS với generated `tsvector`.
- GIN indexes.
- Keyword tag search OR/AND.
- Caption search toggle.
- Filter/sort/pagination.
- Autocomplete có preload/cache.
- Usage profile để ẩn video đã dùng.
- AI topic search đã bắt đầu hỗ trợ query dạng facet, trộn `AND`/`OR`.

Điểm cần tập trung tiếp theo không phải thêm nhiều keyword hơn, mà là làm search thông minh hơn theo corpus:

1. AI chỉ sinh key signal: đối tượng, địa điểm/bối cảnh, hành động đặc trưng.
2. Server validate keyword có tồn tại trong dữ liệu.
3. Search giữ cấu trúc facet: group synonym bằng `OR`, nối các facet quan trọng bằng `AND`.
4. Nếu không có kết quả, relaxed fallback vẫn giữ group thay vì bung OR toàn bộ.
5. Result nên có relevance ranking để video khớp tốt nhất lên đầu.

Nếu triển khai các bước trên, search sẽ đi từ keyword matching cơ bản sang một hệ search có kiểm soát, dễ debug, và cho kết quả đúng intent hơn nhiều.
