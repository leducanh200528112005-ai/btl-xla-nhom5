# AI tư vấn MVP

Hỗ trợ một provider tại mỗi thời điểm, cấu hình trong `backend/.env`.
Không cần cài SDK; dùng httpx đã có trong requirements.

```dotenv
RESIM_AI_PROVIDER=openai
RESIM_AI_API_KEY=your-key
RESIM_AI_MODEL=your-vision-model
RESIM_AI_BASE_URL=
```

- **OpenAI**: `openai`, base URL mặc định `https://api.openai.com/v1`.
- **Gemini**: `gemini`, base URL mặc định `https://generativelanguage.googleapis.com/v1beta`.
  Model dùng tên thuần, không có tiền tố `models/`.
- **Tương thích OpenAI**: `openai_compatible`, bắt buộc cấu hình base URL,
  ví dụ `https://your-provider.example/v1`. Endpoint phải hỗ trợ
  Chat Completions, ảnh data URL và `response_format: json_object`.

Chọn model có hỗ trợ ảnh và JSON tại nhà cung cấp; không phải mọi model hay
API tương thích đều hỗ trợ. Khởi động lại backend sau khi đổi cấu hình.
Không đặt key trong frontend hoặc commit `.env`.

Upload ảnh → AI tư vấn → nhập mục tiêu → Phân tích ảnh → xem nhận xét,
tham số/lý do → Áp dụng cấu hình → tự nhấn Xử lý ảnh.
Áp dụng thay thế các nhóm đang bật và tạo một bước undo; không tự xử lý.
Đề xuất rỗng hợp lệ có nghĩa không bật công cụ nào.

Backend đọc ảnh gốc bằng ID, áp dụng EXIF và tạo JPEG xem trước tối đa 1024 px
mỗi chiều; không sửa nguyên bản. Gửi catalog thật và cấu hình hiện tại.
JSON được kiểm tra lại theo schema/catalog, thứ tự FE, giới hạn pixel.
Không thực thi mã từ AI, không lưu ảnh kết quả hay trả tư vấn mẫu khi API lỗi.
Hội thoại nhận thêm `history` và `current_result_id` (cùng ảnh gốc, còn TTL).
Metadata kết quả lưu snapshot cấu hình. Backend gửi cả preview kết quả và ảnh
gốc, phân biệt cấu hình đang chọn với cấu hình đã tạo ảnh. Không tự retry,
fallback provider hoặc tối ưu tham số bằng chạy thử.

Frontend giữ tối đa 100 sự kiện trong phiên; mỗi lượt gửi 20 sự kiện hoàn tất
gần nhất. Ghi nhận đề xuất, áp dụng, xử lý AI/thủ công và kết quả thật. Slider
không tạo tin nhắn riêng; chỉ xử lý thành công mới tạo phiên bản. Lịch sử và
kết quả gần nhất không bị xóa khi đổi slider/Undo/reset; đổi ảnh xóa toàn bộ.
Không lưu lịch sử qua reload, không gửi ảnh của mọi phiên bản. Kết quả cũ có
TTL 24h; bản legacy thiếu snapshot phải xử lý lại trước khi tham chiếu.

Các lỗi: 503 AI_NOT_CONFIGURED / AI_RATE_LIMITED, 502 AI_PROVIDER_ERROR /
AI_INVALID_RESPONSE, 504 AI_TIMEOUT. Thông báo không đưa nguyên lỗi provider,
key hoặc ảnh vào response.

## Log kiểm tra request/output

Mặc định `RESIM_AI_DEBUG_LOG=true`: terminal chạy uvicorn in `[AI <id>]`
với các sự kiện `REQUEST`, `RESPONSE`, `VALIDATED_PROPOSAL` hoặc `ERROR`.
REQUEST bao gồm toàn bộ system prompt, yêu cầu, catalog, cấu hình hiện tại,
tham số provider và ảnh preview base64. RESPONSE là nguyên body provider kể cả
HTTP lỗi hoặc JSON/đề xuất không hợp lệ. Không log header chứa key; key cấu hình
được che nếu xuất hiện trong nội dung. Timeout/lỗi kết nối không có response
thì chỉ log mã lỗi, không bịa output.

Giới hạn an toàn response vẫn là 1 MB; nếu vượt chỉ ghi prefix và đánh dấu
`truncated: true`. Các phản hồi trong giới hạn không bị cắt.
Log chứa ảnh và nội dung cá nhân, có thể rất dài. Tắt khi không kiểm tra:
`RESIM_AI_DEBUG_LOG=false`, rồi khởi động lại backend.
Không có file log riêng; log hiện tại terminal/backend log collector.

## Kiểm chứng cập nhật hội thoại

- `python -m pytest -q --tb=short -p no:cacheprovider`: 231 passed,
  một cảnh báo deprecation Starlette/httpx.
- `npm.cmd test`: 36 passed, gồm hội thoại nhiều lượt, ảnh/cấu hình kết quả
  chỉnh tay và từ AI, Undo/reset không mất snapshot, thay ảnh xóa chat.
- `npm.cmd run typecheck`: đạt.
- Kiểm tra trình duyệt với backend/frontend thật: upload ảnh kiểm thử được
  sinh riêng, xử lý Gamma thủ công, thấy thumbnail thật và cấu hình trong chat.
  Desktop và viewport mobile 390px không tràn ngang; không có console warn/error.
- Kiểm thử ba adapter gửi đúng hai ảnh bằng HTTP transport doubles; không gọi
  provider trả phí trong đợt kiểm tra này. Chưa nghiệm thu live multi-turn với
  tài khoản AI của người dùng. Không chạy production build khi dev server đang dùng.

Kiểm thử protocol bằng HTTP transport doubles không thay cho kiểm thử API thật.
Cần key/model hợp lệ để nghiệm thu thực tế; có thể phát sinh phí.

## Kiểm chứng MVP

- `python -m pytest -q tests/test_ai_advisor.py tests/test_api.py --tb=short -p no:cacheprovider`:
  51 passed, một cảnh báo deprecation Starlette/httpx.
- Frontend `npm.cmd test`: 28 passed, gồm phân tích → áp dụng không tự xử lý
  và lỗi AI không tạo đề xuất giả.
- `npm.cmd run lint`, `npm.cmd run typecheck`, `git diff --check`: đạt
  (git chỉ cảnh báo chuyển line ending).
- Lỗi OpenCV mở đường dẫn model có dấu đã được sửa sau MVP: nạp Caffe
  bằng buffer byte đọc qua Python. Inference thật và kiểm thử pipeline
  tô màu nay chạy được trên đường dẫn tiếng Việt.
- Chưa gọi provider thật: chưa có key/model để nghiệm thu live. Chưa chạy lại
  production build/browser trong đợt này.
