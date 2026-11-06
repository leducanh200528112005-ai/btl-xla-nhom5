# Hoàn thiện tám chức năng Resim — 06/11/2026

Theo yêu cầu trực tiếp của người dùng, sửa tại backend/ và frontend/ ở gốc repo. Giữ nguyên các công thức đã hoạt động; hoàn thiện phần thiếu và ghép đủ luồng HTTP → xử lý → so sánh → tải PNG. Không thay đổi AGENTS.md đang có sửa đổi của người dùng.

## Các chức năng hiện tại

| Nhóm | Thuật toán và hành vi |
|---|---|
| Khử nhiễu | Median 3/5/7 hoặc Bilateral 5/7/9, sigma_color/sigma_space; giữ công thức có sẵn |
| Độ sáng | Gamma `out = in^(1/gamma)`; sửa lỗi cú pháp `//#` khiến module không import được |
| Tương phản | CLAHE trên L của Lab; giữ công thức có sẵn |
| Làm nét | Unsharp `I + amount * (I - Gaussian(I, sigma))`; float32, làm tròn/clamp uint8, amount=0 giữ nguyên |
| Giảm vết xước | Median 3 → top-hat/black-hat 7×7 → threshold → opening theo bốn hướng → lọc hình dạng → dilation 3×3 → Telea inpainting |
| Giảm ố vàng | Giữ thuật toán Lab có sẵn; ảnh không có ám vàng có thể được giữ nguyên hợp lệ |
| Tô màu | Giữ ECCV16/OpenCV DNN CPU có sẵn; cần trọng số cục bộ, thiếu/hỏng báo 503 |
| Phóng ảnh | Giữ Lanczos 2×/4× có sẵn; tăng kích thước, không tái tạo chi tiết bằng AI |

Vết xước: sensitivity=0 tắt phát hiện; ngưỡng độ tương phản xám `60 - 45*sensitivity`. Cấu trúc dài tối thiểu 9 pixel, mảnh khoảng 5 pixel; xét cả sáng và tối riêng, bốn hướng ngang/dọc/chéo. Đây là heuristic, không phát hiện ngữ nghĩa. Bán kính inpaint theo catalog. Không sửa pixel ngoài mask. Có thể bỏ sót vết cong, rộng, rất ngắn hoặc nhận nhầm tóc, dây, hoa văn. Không tự tạo mask ngẫu nhiên hoặc giả lập kết quả.

Tham khảo triển khai: [OpenCV morphology](https://docs.opencv.org/4.13.0/d9/d61/tutorial_py_morphological_ops.html), [OpenCV Telea inpainting](https://docs.opencv.org/4.13.0/df/d3d/tutorial_py_inpainting.html). Việc chọn ngưỡng/hình dạng là heuristic của ứng dụng, không phải bảo đảm từ tài liệu OpenCV.

## Tích hợp và các file chính

- `app/pipeline.py`: đăng ký đủ chín algorithm ID/tám tool ID, giữ kiểm tra toàn bộ bước trước thực thi, thứ tự client, pixel budget và upscale cuối.
- `app/catalog.py`: công bố từng thuật toán đã triển khai; giữ ID, tên tham số, range/default và cấu trúc HTTP trong api-contract. Thay đổi trạng thái mở rộng phạm vi ba thuật toán trong tài liệu cũ theo yêu cầu mới của người dùng; không thêm trường payload.
- `app/algorithms/{denoise,brightness,contrast}.py`: công thức được giữ, dùng validation BGR uint8 chung để lời gọi trực tiếp có lỗi rõ ràng.
- `app/algorithms/{sharpen,scratches}.py`: thuật toán mới.
- `frontend/src/features/tools/ToolsPanel.tsx`, `frontend/src/features/editor/Editor.tsx`: cập nhật thông tin tám công cụ, giải thích màu dự đoán và giới hạn phát hiện xước.
- `tests/test_restoration.py`: chất lượng vết xước sáng/tối, ngang/dọc/chéo; không sửa input/unmasked pixels; độ nhạy; làm nét không tràn số; ảnh nhỏ; validation; pipeline đủ tám nhóm với cả hai lựa chọn khử nhiễu.
- `scripts/verify_photo.py`: chạy từng thuật toán và pipeline qua FastAPI TestClient thật, tải/giải mã PNG, kiểm tra nguyên bản, xuất report và ảnh để xem. Không dùng mock model.
- Frontend integration tests bổ sung đủ tám công cụ, hai lựa chọn denoise, kiểm tra thứ tự và tham số dạng số.

AI tư vấn nằm ngoài tám chức năng xử lý ảnh, vẫn trả 501 rõ ràng. Không bịa phân tích hoặc đề xuất AI.

## Lệnh kiểm tra

Từ gốc repo:

```powershell
backend/.venv/Scripts/python.exe -m pytest -q --tb=short --basetemp=backend/.venv/test-temp-all-eight -o cache_dir=backend/.venv/pytest-cache-all-eight backend/tests
backend/.venv/Scripts/python.exe -m pip check
backend/.venv/Scripts/python.exe backend/scripts/verify_photo.py --image 'C:/Users/Admin/Pictures/Camera Roll/WIN_20250926_18_49_26_Pro.jpg'
git diff --check
```

Từ frontend/:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Kết quả: 210 backend tests passed, không skip mô hình trên máy này; 26 frontend tests passed; lint, typecheck, build, pip check đạt. Backend còn cảnh báo deprecation Starlette/httpx có sẵn. Máy thiếu trọng số có test inference được đánh dấu skip; cần chạy `backend/scripts/download_colorization.py` để kiểm thử mô hình thật. Không tải trọng số trong request HTTP.

Browser: chạy Next production ở 127.0.0.1:3000 và FastAPI ở 127.0.0.1:8000. Upload đúng ảnh người dùng, bật đủ tám nhóm với Bilateral, xử lý thành công, xem so sánh ảnh gốc/kết quả 3840×2160, tải PNG qua nút UI thành công. Không có console warn/error. Ảnh chụp bằng chứng: `.storage/verification/browser-proof.png`.

## Thử với ảnh người dùng

Ảnh đầu vào 1920×1080. Chín thuật toán chạy riêng và hai pipeline (`all_eight`, `recommended`) đều trả HTTP 200; PNG preview/download giống nhau; bytes ảnh gốc được bảo toàn. Bản đủ tám bước và bản xử lý nhẹ đều đạt 3840×2160. Các con số đo trong `.storage/verification/report.json` là thời gian và mức thay đổi pixel, không phải thước đo chất lượng phục hồi khi không có ảnh chuẩn sạch.

Đã xem contact sheet và crop chi tiết: ảnh chủ yếu có nhiễu, đã có màu; tô màu làm thay đổi màu da/ánh sáng, CLAHE mặc định tăng hạt rõ. Với ảnh này nên dùng Bilateral và mức gamma/CLAHE/làm nét nhẹ, không bật tô màu, giảm xước hoặc giảm vàng khi không cần. Bản `recommended.png` chỉ cải thiện nhẹ, vẫn còn nhiễu; không tuyên bố ảnh đã sạch hay khôi phục chi tiết bị mất.

Giảm vàng trên ảnh này giữ nguyên pixel vì thuật toán không nhận thấy ám vàng cần sửa. Mask xước mặc định chiếm khoảng 0.03% diện tích; ảnh không có xước chuẩn nên không thể dùng nó để chứng minh độ chính xác phát hiện. Chất lượng inpainting được kiểm tra thêm bằng vết xước nhân tạo đã biết.

Phóng 4× nguyên ảnh tạo 33,177,600 pixel, vượt giới hạn mặc định 32,000,000 nên trả 422 IMAGE_TOO_LARGE đúng thiết kế. Phóng 4× ảnh nhỏ đã được kiểm thử. Muốn xử lý 4× ảnh này có thể tăng RESIM_MAX_RESULT_PIXELS với đủ RAM; không tự nới giới hạn tài nguyên.

Ảnh cá nhân, kết quả, report và kho API thử nằm trong `.storage/verification/` (gitignored), không đưa ảnh người dùng vào mã nguồn. Script có thể tái chạy với `--image` và `--output-dir`. File tải thử bằng browser nằm trong thư mục Downloads của người dùng.
