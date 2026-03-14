# Hướng Dẫn Sử Dụng Hệ Thống Deep Video Search 🔍

Chào mừng bạn đến với hệ thống **Deep Video Search** - một giải pháp mạnh mẽ để tìm kiếm, phân tích và quản lý metadata video YouTube ở quy mô lớn.

---

## 1. Tổng Quan Về Hệ Thống
Hệ thống này được thiết kế để giúp người dùng tra cứu nhanh chóng hàng ngàn video dựa trên nội dung phụ đề (Caption) và bản tóm tắt phân tích (Summary) được tạo bởi AI.

### Các thành phần chính:
- **Web Frontend**: Giao diện người dùng (React), nơi thực hiện các thao tác tìm kiếm và xem dữ liệu.
- **Web Backend**: API (FastAPI) kết nối với cơ sở dữ liệu Supabase để xử lý tìm kiếm và sắp xếp.
- **Công cụ Phân tích (AI)**: Script Python sử dụng Ollama (Llama 3.2 3B) để tự động tóm tắt nội dung video.
- **Cơ sở dữ liệu**: Supabase (PostgreSQL) để lưu trữ dữ liệu an toàn và tốc độ cao.

---

## 2. Tính Năng & Cách Hoạt Động

### A. Tính năng Tìm kiếm Chuyên sâu
Hệ thống không chỉ tìm theo tiêu đề mà còn tìm trong **Phụ đề** và **Tóm tắt nội dung**.
- **Tìm kiếm đa từ khóa (Multi-tag)**: Bạn có thể nhập nhiều từ khóa cùng lúc.
- **Chế độ AND/OR**:
    - **OR**: Trả về video chứa ít nhất một trong các từ khóa.
    - **AND**: Chỉ trả về video chứa tất cả các từ khóa đã nhập.
- **Tự động làm nổi bật (Highlight)**: Các từ khóa tìm thấy sẽ được tô màu khác nhau để dễ nhận diện.
- **Tự động cuộn tới kết quả**: Khi bạn mở một cell có chứa từ khóa, hệ thống sẽ tự động cuộn đến vị trí từ khóa đó.

### B. Tính năng Giao diện (UI/UX)
- **Infinite Scrolling (Cuộn vô tận)**: Dữ liệu được tải theo lô (200 bản ghi mỗi lần) giúp ứng dụng luôn mượt mà dù có hàng triệu video.
- **Thay đổi kích thước cột**: Bạn có thể kéo dãn độ rộng các cột (Tiêu đề, Phụ đề, Tóm tắt...) tùy ý.
- **Giao diện sáng/tối (Dark/Light Mode)**: Phù hợp với mọi điều kiện làm việc.
- **Thumbnail thông minh**: Tự động hiển thị thumbnail từ YouTube hoặc fallback nếu thiếu ảnh.

### C. Tính năng Quản trị
- **Trang Admin**: Truy cập qua `/admin` để cập nhật dữ liệu (đang phát triển phần upload trực tiếp).
- **Phân tích tự động**: Sử dụng AI để đọc phụ đề và trích xuất: Nội dung chính, Nhân vật, Địa điểm, Loại xung đột và Keywords.

---

## 3. Hướng Dẫn Thao Tác Trên Web

### 1. Tìm kiếm Video
1. Truy cập vào trang chủ.
2. Nhập từ khóa vào ô tìm kiếm.
3. Nhấn phím `,` (dấu phẩy) hoặc `Enter` để tạo một **Tag** tìm kiếm.
4. Bạn có thể thêm nhiều Tag. Để xóa Tag, nhấn dấu `x` trên mỗi Tag.
5. Nhấn biểu tượng 🔍 (Kính lúp) hoặc nhấn `Enter` lần nữa để thực thi tìm kiếm.

### 2. Thay đổi chế độ tìm kiếm
- Nhấp vào nút **OR** hoặc **AND** ở góc trên bên phải để chuyển đổi giữa tìm kiếm linh hoạt (OR) và tìm kiếm chính xác (AND).

### 3. Sắp xếp dữ liệu
- Nhấp vào **Tiêu đề cột** (Ví dụ: Lượt xem, Ngày đăng) để sắp xếp tăng dần hoặc giảm dần.

### 4. Xem nội dung chi tiết
- Đối với các cột như **Phụ đề** hay **Phân tích**, bạn có thể cuộn chuột ngay trong ô đó để đọc toàn bộ văn bản.
- Nếu có từ khóa highlight, ô sẽ tự động cuộn đến vị trí đó để bạn đọc nhanh.

### 5. Xem Video gốc
- Nhấp vào biểu tượng **YouTube (màu đỏ)** trong cột Link để mở video gốc trong tab mới.

---

## 4. Quy Trình Cập Nhật Dữ Liệu (Dành cho Admin)

Nếu bạn muốn thêm video mới vào hệ thống, hãy thực hiện theo các bước sau:

**Bước 1: Chuẩn bị file Excel**
- Đảm bảo file `data.xlsx` có danh sách URL YouTube cần xử lý.

**Bước 2: Chạy phân tích AI (Caption & Summary)**
- Mở Terminal và chạy lệnh:
  ```bash
  python video_analysis_v2.py
  ```
- Script này sẽ tự động tải phụ đề và dùng AI Llama 3.2 để tóm tắt nội dung vào file Excel.

**Bước 3: Đồng bộ lên Cơ sở dữ liệu (Supabase)**
- Sau khi file Excel đã cập nhật đủ Caption và Summary, chạy lệnh:
  ```bash
  python sync_to_supabase.py
  ```
- Dữ liệu từ Excel sẽ được đẩy lên đám mây và sẵn sàng để tìm kiếm trên Web.

---

## 5. Hướng Dẫn Cài Đặt Local (Để chạy trên máy)

### Yêu cầu:
- Node.js & npm (để chạy Web)
- Python 3.x (để chạy Script dữ liệu)
- Ollama (để chạy AI tóm tắt)

### Các lệnh cài đặt:

**1. Khởi động Frontend:**
```bash
cd web_frontend
npm install
npm run dev
```

**2. Khởi động Backend:**
```bash
cd web_backend
pip install -r requirements.txt
python main.py
```

---
*Chúc bạn có những trải nghiệm tuyệt vời với Deep Video Search!*
