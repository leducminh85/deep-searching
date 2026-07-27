# Báo cáo sau cập nhật AI Topic Search

Ngày lập báo cáo: 27/07/2026
Phạm vi: đánh giá tình hình AI Topic Search sau khi bổ sung corpus-aware validation, fallback theo facet và metadata debug.

## 1. Mục tiêu cập nhật

Trước cập nhật, AI Topic Search có vấn đề chính: chủ đề tự nhiên của user được AI chuyển thành nhiều keyword/facet, sau đó backend nối các facet bằng `AND`. Nếu chỉ một facet không có từ nào khớp corpus thật, toàn bộ query có thể trả về 0 kết quả.

Mục tiêu lần cập nhật này:

- Kiểm tra keyword AI sinh ra có tồn tại trong corpus thật hay không.
- Loại bỏ term/facet không match corpus trước khi build query.
- Nếu strict query vẫn ra 0, fallback theo hướng giữ intent thay vì bung OR toàn bộ.
- Trả metadata debug để biết query thật, facet nào match, facet nào bị bỏ.
- Điều chỉnh prompt Ollama để sinh keyword sát corpus hơn.

## 2. Thay đổi đã thực hiện

### 2.1. Corpus-aware term validation

Đã thêm cache lexeme dictionary lấy từ PostgreSQL:

```sql
SELECT word, nentry
FROM ts_stat('SELECT fts_no_caption FROM videos')
WHERE length(word) >= 2
ORDER BY nentry DESC
LIMIT 20000
```

Cache:

- TTL: 10 phút.
- Không đổi schema DB.
- Dùng memory cache trong server process.

Plan AI trước khi search sẽ được validate:

- Term tồn tại trong corpus: giữ lại.
- Term không tồn tại: loại khỏi group.
- Group rỗng sau khi lọc: đánh dấu `unmatched_facets` và bỏ khỏi query chính.

### 2.2. Giảm số facet tối đa

Đã giảm:

```txt
MAX_ADVANCED_GROUPS: 6 -> 3
```

Lý do:

- Mỗi facet nối bằng `AND` làm tăng xác suất query trả 0.
- 2-3 facet là đủ cho hầu hết chủ đề search video:
  - đối tượng/thực thể;
  - địa điểm/bối cảnh;
  - hành động đặc trưng nếu cần.

### 2.3. Fallback query mới

Thứ tự chạy hiện tại:

```txt
1. strict query
2. relaxed phrase query
3. drop weakest facet nếu có nhiều hơn 2 facet
4. optional OR nếu vẫn 0
```

Điểm quan trọng:

- Relaxed fallback không còn đơn giản chỉ bung OR toàn bộ.
- Hệ thống ưu tiên giữ cấu trúc facet.
- Chỉ khi strict/relaxed không có kết quả mới nới thêm.

### 2.4. Metadata debug trong `/api/data`

Response cũ vẫn giữ nguyên:

```json
{
  "data": [],
  "total": 0,
  "page": 1,
  "page_size": 50
}
```

Khi `mode=advanced`, response có thêm field:

```json
{
  "search": {
    "mode": "advanced",
    "fts_column": "fts_no_caption",
    "strict_total": 0,
    "relaxed": true,
    "strategy": "drop_weakest_facet",
    "effective_query": "...",
    "dropped_facets": [],
    "dropped_terms": [],
    "unmatched_facets": [],
    "facet_lexeme_counts": [],
    "facet_match_counts": []
  }
}
```

Ý nghĩa:

- `strict_total`: số kết quả của query strict ban đầu.
- `relaxed`: backend có phải nới query không.
- `strategy`: chiến lược query cuối cùng được dùng.
- `effective_query`: tsquery thực tế đã chạy.
- `dropped_terms`: term AI sinh nhưng không có trong corpus.
- `dropped_facets`: facet bị bỏ.
- `unmatched_facets`: facet hoàn toàn không match corpus.
- `facet_match_counts`: số video match từng facet riêng lẻ.

### 2.5. Prompt Ollama mới

Prompt đã được chỉnh:

- Không còn ép “common English search terms” quá cứng.
- Đưa top lexeme thật từ corpus vào prompt.
- Nhắc rõ PostgreSQL đang dùng `simple` FTS:
  - không stemming;
  - không synonym tự nhiên;
  - không accent folding.
- Nếu input tiếng Việt, yêu cầu cân nhắc:
  - từ tiếng Việt có dấu;
  - từ tiếng Việt không dấu;
  - English equivalent khi có khả năng match.
- Chỉ sinh key signal:
  - subject/person/entity;
  - location/object/context;
  - distinctive action.

## 3. Kết quả kiểm thử

Đã chạy diagnostic trực tiếp bằng `queryVideos()` với DB local.

Lưu ý:

- Test chạy với `captionSearch=false`, tức dùng `fts_no_caption`.
- Mỗi test lấy page 1, `pageSize=5`.
- Các plan test là plan facet đúng kỳ vọng, không phụ thuộc Ollama runtime.

## 4. Kết quả theo từng chủ đề

### 4.1. Chủ đề: các vụ Karen gây rối ở sân bay

Plan:

```txt
(airport OR airplane OR flight OR passenger)
AND
(karen OR woman OR girl)
```

Kết quả:

```txt
total: 1052
strategy: strict
strict_total: 1052
relaxed: false
facet_match_counts: [2586, 14997]
```

Sample titles:

- `Airport Hotel Was Not Prepared For THIS Guest!`
- `Drunk Passenger Has Massive Meltdown at TSA Checkpoint Over Getting His Meat Touched`
- `Woman Returns for More After Cashing $15,000 Fraudulent Check, Fails Miserably`

Nhận xét:

- Query strict đã đủ tốt, không cần fallback.
- Facet sân bay/chuyến bay có 2586 video match riêng.
- Facet Karen/woman/girl có 14997 video match riêng.
- Kết quả cuối 1052 cho thấy `AND` giữa hai facet không bị quá chặt trong case này.

### 4.2. Chủ đề: sovereign citizen bị bắt

Plan:

```txt
("sovereign citizen" OR sovereign OR freeman)
AND
(arrested OR arrest OR police OR detained)
```

Kết quả:

```txt
total: 578
strategy: strict
strict_total: 578
relaxed: false
facet_match_counts: [697, 28237]
```

Sample titles:

- `Bar Fight Chaos: Man Gets Shot in the Head`
- `Cop Teaches Sovereign Citizen a Brutal Lesson He Won't EVER Forget`
- `Arrogant Sovereign Citizen Debates the Law With Police And Loses`

Nhận xét:

- Entity `sovereign citizen` có mặt trong corpus.
- Facet hành động/cảnh sát rất rộng, match 28237 video.
- Query cuối trả 578 kết quả, đủ tốt.
- Sample đầu tiên có thể chưa thật sự liên quan mạnh, cho thấy vấn đề tiếp theo là ranking/relevance, không phải query trả 0.

### 4.3. Chủ đề: passenger meltdown on flight

Plan:

```txt
(passenger OR woman OR man)
AND
(flight OR airplane OR airport)
AND
(meltdown OR argument OR disturbance)
```

Kết quả:

```txt
total: 343
strategy: strict
strict_total: 343
relaxed: false
facet_match_counts: [20101, 1347, 5295]
```

Sample titles:

- `Airport Hotel Was Not Prepared For THIS Guest!`
- `Drunk Passenger Has Massive Meltdown at TSA Checkpoint Over Getting His Meat Touched`
- `Drunk Entitled Man Tries Pushing Past Airport Staff... Then Does This`

Nhận xét:

- 3 facet vẫn không làm query chết.
- Facet bối cảnh bay/sân bay là facet hẹp nhất: 1347.
- Kết quả 343 khá hợp lý.
- Sample thứ hai rất sát intent.

### 4.4. Chủ đề: road rage police arrest

Plan:

```txt
("road rage" OR traffic OR driver)
AND
(police OR officer OR cop)
AND
(arrest OR arrested OR detained)
```

Kết quả:

```txt
total: 5590
strategy: strict
strict_total: 5590
relaxed: false
facet_match_counts: [10286, 28654, 18231]
```

Sample titles:

- `Entitled Rich Tourist Thinks the Law Only Apply for Poor People`
- `Enraged Man Meets Karma After Hit-And-Run`
- `This Couple’s Relationship Had Even The Police Laugh`

Nhận xét:

- Query trả rất nhiều kết quả.
- Facet đều rộng, nhất là police/officer/cop.
- Đây là ví dụ cho thấy search hiện tại cần ranking tốt hơn: kết quả nhiều nhưng top result chưa chắc khớp intent nhất.

### 4.5. Chủ đề: shoplifting suspect arrested

Plan:

```txt
(shoplifting OR theft OR stolen)
AND
(suspect OR woman OR man)
AND
(arrested OR police OR detained)
```

Kết quả:

```txt
total: 3091
strategy: strict
strict_total: 3091
relaxed: false
facet_match_counts: [4887, 21983, 26849]
```

Sample titles:

- `Woman's Shoplifting Attempt Ends in Disaster (Police Bodycam)`
- `Chaos Erupts When He Realizes His Messenger Chat Got Leaked`
- `Drunk Man Starts Drinking Stolen Aldi Wine Right in Front of Police… Then This Happens`

Nhận xét:

- Query strict trả kết quả tốt.
- Sample đầu tiên rất sát.
- Một số sample sau rộng hơn intent, tiếp tục cho thấy ranking/relevance là điểm cần cải thiện.

## 5. Test facet không tồn tại trong corpus

Đã chạy test cố tình đưa facet fake:

Plan ban đầu:

```txt
(airport OR flight)
AND
(nonexistentfacetzzz OR fakekeywordzzz)
AND
(karen OR woman)
```

Kết quả sau validation:

```txt
effective_query: (airport OR flight) AND (karen OR woman)
total: 654
strategy: strict
strict_total: 654
dropped_facets:
  - [nonexistentfacetzzz, fakekeywordzzz]
dropped_terms:
  - nonexistentfacetzzz
  - fakekeywordzzz
unmatched_facets:
  - [nonexistentfacetzzz, fakekeywordzzz]
facet_match_counts: [1340, 14218]
```

Nhận xét:

- Corpus validation hoạt động đúng.
- Facet không có term nào tồn tại trong corpus đã bị bỏ.
- Query còn lại vẫn trả 654 kết quả.
- Metadata debug đủ rõ để biết chính xác facet nào bị loại.

## 6. Kết luận sau kiểm thử

### 6.1. Giả thuyết đã được verify

#### Giả thuyết 1: AND giữa facet quá dễ vỡ

Kết luận: đúng một phần.

Với plan tốt, `AND` giữa 2-3 facet không gây 0 kết quả trong các case test. Các chủ đề mẫu đều trả kết quả bằng strict query.

Tuy nhiên, nếu một facet chứa toàn term không tồn tại trong corpus, `AND` sẽ làm query chết. Bản cập nhật đã xử lý bằng cách validate corpus và drop unmatched facet trước khi query.

#### Giả thuyết 2: AI không biết corpus thực tế

Kết luận: rất có khả năng là nguyên nhân chính.

Các plan thủ công đúng intent đều trả kết quả tốt. Điều này cho thấy search engine FTS không phải vấn đề lớn nhất; vấn đề nằm ở chất lượng term/facet AI sinh ra.

Bản cập nhật đã giảm rủi ro bằng cách:

- đưa top lexeme corpus vào prompt;
- validate term AI sinh ra;
- loại term không tồn tại;
- drop facet rỗng.

#### Giả thuyết 3: Model có thể fallback về fallbackPlan

Kết luận: cần theo dõi qua field `warning`.

Route `/api/search/topic` hiện trả:

```txt
warning
model
corpusHints
```

Nếu `model = null` và `warning` có nội dung “Không kết nối được AI...”, nghĩa là đang dùng fallback chứ không phải plan Ollama thật.

#### Giả thuyết 4: Quá nhiều facet làm AND fail

Kết luận: đã giảm rủi ro.

`MAX_ADVANCED_GROUPS` đã giảm còn 3. Đây là mức hợp lý hơn cho search hiện tại.

## 7. Tình hình hiện tại sau cập nhật

### 7.1. Điểm đã cải thiện rõ

- Query không còn chết chỉ vì AI sinh một facet không tồn tại.
- Backend có thể tự bỏ facet rỗng.
- Có metadata để debug production.
- Prompt AI có corpus hints thật.
- Fallback vẫn giữ cấu trúc facet thay vì bung OR toàn bộ quá sớm.
- Có test script cho query builder.

### 7.2. Vấn đề còn tồn tại

#### Ranking chưa tốt

Kết quả trả nhiều nhưng top result chưa luôn sát intent.

Ví dụ:

- `sovereign citizen bị bắt` có sample đầu tiên không rõ liên quan sovereign citizen.
- `road rage police arrest` trả 5590 kết quả, top result khá rộng.

Nguyên nhân:

- Backend đang sort theo `date_published` hoặc sort user chọn.
- Chưa dùng `ts_rank`/`ts_rank_cd`.
- Chưa ưu tiên video match nhiều facet hơn hoặc match title/summary mạnh hơn.

#### AI vẫn có thể sinh facet rộng

Ví dụ facet:

```txt
woman OR man
police OR officer
```

rất rộng, giúp có kết quả nhưng có thể làm nhiễu.

#### Validation chỉ kiểm tra lexeme tồn tại, chưa đo chất lượng semantic

Một term có tồn tại trong corpus không có nghĩa là term đó tốt.

Ví dụ:

- `man`
- `woman`
- `police`

có count rất cao, làm query rộng.

## 8. Khuyến nghị bước tiếp theo

### 8.1. Thêm relevance ranking

Nên thêm ranking khi có query:

```sql
ts_rank_cd(fts_column, to_tsquery('simple', $query)) AS rank
```

Sau đó sort:

```txt
rank DESC, date_published DESC
```

Hoặc thêm option:

```txt
Sắp xếp: Liên quan nhất / Mới nhất / Nhiều view nhất
```

### 8.2. Thêm facet scoring

Thay vì chỉ filter `AND`, có thể scoring:

```txt
score = số facet video match
```

Sau đó:

- video match 3/3 facet lên trước;
- video match 2/3 vẫn có thể hiện nếu 3/3 ít;
- video match 1/3 thấp hơn.

Đây là hướng tốt cho topic search vì intent tự nhiên thường mềm hơn keyword exact.

### 8.3. Penalize term quá rộng

Nên dùng `nentry` từ lexeme dictionary để đánh dấu term rộng:

```txt
man, woman, police
```

Nếu term count quá cao, vẫn giữ nhưng không nên là term duy nhất trong facet quan trọng.

### 8.4. Log search metadata

Nên ghi thêm metadata advanced vào Supabase hoặc local DB:

```txt
topic
plan
validated_plan
effective_query
strategy
strict_total
dropped_terms
dropped_facets
facet_match_counts
```

Hiện metadata đã trả về response, nhưng chưa lưu lại.

### 8.5. UI debug nhẹ

Trong UI có thể hiển thị nhỏ:

```txt
Đã bỏ 1 nhóm từ khóa không có trong dữ liệu.
```

Hoặc trong dev mode:

```txt
strict: 0, strategy: drop_weakest_facet
```

## 9. Trạng thái kiểm thử kỹ thuật

Đã chạy:

```txt
node scripts/search-query-builder.test.js
```

Kết quả:

```txt
search-query-builder tests passed
```

Đã chạy:

```txt
npm run build
```

Kết quả:

```txt
Compiled successfully
```

Ghi chú:

- Node có warning `MODULE_TYPELESS_PACKAGE_JSON` khi chạy test script ESM. Đây là warning do `package.json` chưa khai báo `"type": "module"`, không làm test fail.
- Không build Docker.
- Chưa commit.

## 10. Kết luận cuối

Sau cập nhật, AI Topic Search đã ổn hơn ở tầng backend:

- Có corpus-aware validation.
- Có fallback theo facet.
- Có metadata debug.
- Các case thực tế được test đều trả kết quả.
- Case facet không tồn tại được xử lý đúng.

Kết quả test cho thấy vấn đề lớn nhất không phải PostgreSQL FTS không tìm được, mà là chất lượng keyword/facet AI sinh ra và cách sắp xếp kết quả. Bước tiếp theo nên tập trung vào relevance ranking và facet scoring, vì hiện tại query đã có kết quả nhưng top result đôi khi còn rộng hoặc chưa sát intent nhất.
