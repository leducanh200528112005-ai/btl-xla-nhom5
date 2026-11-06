> Cập nhật mới nhất 06/11/2026: đã hoàn thiện và tích hợp cả tám nhóm công cụ (chín thuật toán). Xem [RESTORATION.md](RESTORATION.md) cho thuật toán, kiểm thử và kết quả trên ảnh người dùng. Nội dung người 3/4 dưới đây là bàn giao lịch sử; giới hạn chỉ chạy ba thuật toán đã được thay thế. AI tư vấn vẫn là stub.

# Bàn giao người 3 và 4 — 2026-11-06

Theo yêu cầu mới và xác nhận thư mục của người dùng, làm việc trực tiếp với backend/ và frontend/ ở gốc repo. Đã triển khai ba thuật toán và ghép luồng upload → process → xem/so sánh → download. Không sửa các module denoise, brightness, contrast, sharpen, scratches hoặc AI advisor.

## Thuật toán

- Người 3 / remove_yellow_cast: chuyển BGR sang CIE Lab, ước lượng b* dương từ vùng sáng có chroma vừa phải, giảm ám vàng (tối đa 35 đơn vị b*) và hạn chế tác động vào vùng đen. Giữ L*, a*, trộn kết quả bằng strength. Đây là hiệu chỉnh ám màu toàn ảnh, không phát hiện từng vết ố cục bộ.
- Người 3 / colorize_image: mô hình Colorful Image Colorization ECCV16 của Zhang và cộng sự, chạy OpenCV DNN CPU. Đầu vào mô hình 224×224; dự đoán a*/b*, ghép với L* của ảnh đầu vào rồi trộn bằng strength. Cache mô hình và khóa setInput/forward để các request không dùng lẫn dữ liệu. strength=0 giữ đúng pixel và không cần model.
- Người 4 / upscale_image: nội suy Lanczos 2× hoặc 4×. Đây không phải AI super-resolution; không cam kết tái tạo chi tiết bị mất.
- Các hàm trả BGR uint8, không sửa input, kiểm tra tham số bằng nguồn catalog chung.

Nguồn mô hình: [richzhang/colorization](https://github.com/richzhang/colorization/tree/caffe). Hướng tích hợp DNN tham khảo [mẫu chính thức OpenCV](https://github.com/opencv/opencv/blob/4.x/samples/dnn/colorization.py). Checksum model và prototxt đối chiếu [OpenCV extra](https://github.com/opencv/opencv_extra/blob/4.x/testdata/dnn/download_models.py).

## Ghép API và frontend

- Giữ nguyên ID, tham số, payload và ProcessResult đã định nghĩa. Ba thuật toán trên có implementation_status=implemented.
- Pipeline kiểm tra toàn bộ bước trước xử lý; người 1/2 vẫn không được đăng ký, request chứa công cụ này trả 501, không bỏ qua bước và không trả kết quả một phần. Các hàm người 1 đã có code/test trong repo được giữ nguyên.
- Process chạy trong threadpool FastAPI, giới hạn một request xử lý trên mỗi tiến trình; request đồng thời trả 503 PROCESSING_BUSY. Health/catalog vẫn phản hồi.
- Luôn xử lý lại từ ảnh gốc, giữ nguyên bytes gốc. Giải mã có EXIF orientation, giữ alpha PNG; kết quả PNG nằm riêng ở .storage/results với UUID và TTL 24h.
- GET /api/results/{result_id} để xem, GET /api/download/{result_id} để tải cùng PNG. Không nhận ID ảnh gốc thay result_id.
- Kiểm tra kích thước đầu ra trước resize; mặc định tối đa 32 triệu pixel. Ảnh 20 triệu pixel không thể phóng 4× với giới hạn này.
- FE nhận trạng thái catalog mới, hiện metadata kết quả thật, so sánh trong cùng khung kể cả ảnh upscale, khóa controls khi xử lý và bỏ response cũ khi đổi ảnh.
- Khi đổi/undo/reset cấu hình, kết quả cũ bị xóa để tránh gắn kết quả với thông số khác. So sánh/tải chỉ mở khi có result thật.
- AI tư vấn vẫn là stub. Các thay đổi hợp đồng được ghi trong docs/api-contract.md; các spec scaffold có ghi chú phạm vi mới.

## Cài đặt và chạy

Trong backend (PowerShell):

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-dev.txt
.\.venv\Scripts\python.exe scripts/download_colorization.py
.\run.cmd
```

Trong frontend:

```powershell
npm.cmd ci
npm.cmd run dev
```

Mở http://localhost:3000. Nếu chưa có virtualenv, tạo bằng python -m venv .venv trước. Không cần GPU hoặc API key.

Trọng số khoảng 123 MiB đã tải và xác minh trên máy hiện tại; không đưa binary vào git. Máy khác cần chạy script tải một lần. Script kiểm tra checksum, ghi file tạm rồi thay thế; ưu tiên nguồn OpenCV và dùng mirror khớp checksum khi nguồn chính trả 403. Không tải mô hình trong HTTP request.

Cấu hình mới:
- RESIM_COLORIZATION_MODEL_DIR=models/colorization
- RESIM_MAX_RESULT_PIXELS=32000000

OpenCV được khóa ở 4.13.0.92 vì 5.0.0.93 đã bỏ readNetFromCaffe. requirements.txt được chuyển từ UTF-16 sang UTF-8 để dễ dùng với tooling và review.

## Kiểm chứng

Môi trường thực tế: Windows, Python 3.14.5, OpenCV 4.13.0, NumPy 2.5.4, Node/npm theo môi trường repo.

Các lệnh đã chạy:

```powershell
# backend
.\.venv\Scripts\python.exe -m pytest -q --tb=short --basetemp=.venv/test-temp-member34-final -o cache_dir=.venv/pytest-cache-member34
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe scripts/download_colorization.py

# frontend
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build

# gốc repo
git diff --check
```

Kết quả: 171 backend tests passed (không skip mô hình thật), 24 frontend tests passed; lint/typecheck/production build đạt; pip check không lỗi. Pytest còn một cảnh báo deprecation từ Starlette/httpx có sẵn, không ảnh hưởng kết quả. Dùng basetemp/cache_dir riêng vì thư mục pytest tạm cũ của máy bị từ chối truy cập.

Backend tests gồm đặc tính giảm ám vàng, strength=0, scale 2/4, không sửa input, validation, thực thi theo thứ tự, chặn bước chưa hoàn thiện trước xử lý, pixel cap, thiếu/hỏng model, concurrent inference, TTL, alpha, EXIF, upload/process/preview/download. Test legacy yêu cầu người 1 luôn raise NotImplementedError đã được bỏ khỏi test_stubs; các test riêng test_denoise.py, test_brightness.py, test_contrast.py giữ nguyên và đều chạy đạt.

Browser chạy trên production build + FastAPI thật:
- Upload ảnh kiểm thử 900×675 từ bộ ví dụ chính thức của mô hình, bật cả ba bước với upscale 4×.
- Nhận PNG tô màu 3600×2700, khoảng 8.2 MiB; ảnh gốc vẫn 900×675.
- So sánh hai ảnh thực tế và tải PNG qua nút FE thành công.
- Không có console error/warning.
- Kiểm tra desktop 1280 px và mobile 390 px; không tràn ngang.
- Ảnh chụp kiểm chứng cục bộ: .venv/member34-browser-proof.png (không commit).

## Giới hạn còn lại

- Màu do mô hình dự đoán có thể không đúng màu lịch sử; chất lượng phụ thuộc nội dung, ảnh tối hoặc mặt người có thể tô sai.
- Hiệu chỉnh ám vàng có thể tác động tới vật thể vốn màu vàng; nên giảm strength cho ảnh này. Không xử lý riêng vùng ố.
- Lanczos tăng kích thước và nội suy, không tạo chi tiết mới như mô hình super-resolution.
- Chỉ hỗ trợ các bước người 3/4 trong pipeline; phần người 1/2 và advisor để người dùng hoàn thiện sau.
- Chưa có queue/GPU/batch; mỗi worker xử lý một ảnh. Storage cục bộ có TTL, không phải lưu trữ lâu dài.
