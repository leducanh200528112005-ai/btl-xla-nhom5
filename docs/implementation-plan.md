# Resim — kế hoạch triển khai frontend và khung backend

> Cập nhật 2026-11-06: theo yêu cầu mới, triển khai và ghép FE/BE cho người 3/4 (giảm ố vàng, tô màu ECCV16, upscale Lanczos), giữ người 1/2 và AI ngoài pipeline. Dùng thư mục backend/, frontend/ tại gốc repo theo xác nhận người dùng. Phần scaffold dưới đây là kế hoạch ban đầu; các yêu cầu giữ ba thuật toán/pipeline/kết quả là stub đã được thay thế bởi [hợp đồng hiện tại](api-contract.md) và [bàn giao](../backend/IMPLEMENTATION.md).

## 1. Đích đến đã được người dùng duyệt

Resim là web app khôi phục ảnh cũ có AI tư vấn. Đợt này chỉ xây giao diện editor, kết nối HTTP và hạ tầng backend tối thiểu. Thuật toán, pipeline thực thi và AI được bàn giao dưới dạng hàm chưa triển khai.

Các quyết định cố định:
1. Frontend: Next.js App Router + TypeScript + Tailwind CSS; không dùng Vite.
2. Backend: Python 3.12 + FastAPI + Pydantic, chạy riêng với Next.js.
3. Route `/` mở thẳng editor. Upload là empty state của vùng xem ảnh trong cùng editor, không phải landing page, modal bắt buộc hoặc route khác.
4. Giao diện kết hợp trình chỉnh ảnh tối giản kiểu Remini và vùng so sánh kiểu Squoosh: canvas lớn bên trái, một sidebar bên phải với hai tab `Công cụ` / `AI tư vấn`.
5. Không có trang đăng nhập, marketing, thanh toán, watermark, xử lý hàng loạt hoặc công cụ cọ/tẩy/tô mask.
6. Không có chế độ mock/demo, ảnh mẫu được gieo sẵn, bộ lọc CSS mô phỏng hoặc AI trả lời giả.
7. Chưa có kết quả thật thì chỉ hiển thị bản gốc; download/comparison không được giả hoạt động.
8. UI tiếng Việt. Code và hợp đồng dùng identifier tiếng Anh nhất quán.

Các tài liệu thực thi:
- `api-contract.md`: nguồn chuẩn cho request, response, thuật toán và tham số.
- `frontend-spec.md`: thiết kế, state machine và tương tác giao diện.
- `backend-spec.md`: cấu trúc backend, lưu ảnh, lỗi và stubs.

## 2. Ranh giới phạm vi

### Làm thật
- Trang editor responsive, dropzone tích hợp, local preview, zoom/fit/pan cơ bản.
- Sidebar tám chức năng, thay đổi tham số, bật/tắt, đặt lại, undo cấu hình.
- Upload JPG/PNG qua HTTP, trả ID và metadata, phục vụ lại đúng byte ảnh gốc.
- Catalog thuật toán và cấu hình dự kiến từ backend; health và CORS.
- Gửi request process/advise, hiển thị lỗi backend và trạng thái chưa triển khai một cách trung thực.
- Kiểm tra dữ liệu request; từ chối thuật toán/tham số không hợp lệ.
- Khung kết quả và AI để cắm dữ liệu thật về sau.
- Tài liệu chạy, hợp đồng và kiểm thử.

### Để trống có chủ đích
- Mọi công thức/filter/phát hiện mask/inpainting/xử lý màu/AI upscale.
- `pipeline.process_image(...)`.
- AI advisor, gọi provider, API key, model download.
- Sinh/lưu ảnh đã xử lý, hoàn tác phiên bản ảnh, export ảnh đã xử lý.

Các phần này có type, docstring và `raise NotImplementedError(...)`. Endpoint tương ứng trả HTTP 501 theo hợp đồng. Lưu và kiểm tra file ảnh là hạ tầng, không phải thuật toán khôi phục.

## 3. Phân công và quyền sửa file

| Chủ nhiệm | Phạm vi được tạo/sửa | Trách nhiệm |
|---|---|---|
| Coordinator | `docs/`, `AGENTS.md`, `README.md`, `.gitignore`; sửa tích hợp khi các agent đã kết thúc | Đặc tả, khóa hợp đồng, kiểm tra frontend/backend và browser, bàn giao |
| Frontend subagent | Chỉ `frontend/**` | Next.js, UI, HTTP client, state, tests frontend |
| Backend subagent | Chỉ `backend/**` | FastAPI, schemas, catalog, storage, stubs, tests backend |

Cả hai subagent dùng `openai/gpt-6-luna#max`. Nếu cần thay đổi tài liệu/hợp đồng hoặc file ngoài quyền sở hữu, báo coordinator. Không chỉnh file của agent khác trong lúc làm song song.

Trong P2, sau khi P1 đã bàn giao, các sửa lỗi frontend được tách quyền sở hữu nhỏ hơn để chạy song song:
- Agent frontend: `ToolsPanel.tsx`, test DOM liên quan, cấu hình/dependencies test và icon cục bộ. Nhiệm vụ: giữ focus và đồng bộ draft của control.
- Agent rà soát: `Editor.tsx` và helper/test mới `src/lib/image-validation.*`. Nhiệm vụ: kiểm tra JPEG/PNG theo nội dung thay vì tin extension/MIME.
- Coordinator không sửa các file trên cho đến khi hai nhiệm vụ kết thúc; sau đó chạy lại toàn bộ checks và browser. Không agent nào tự mở server hoặc thay đổi hợp đồng API.

## 4. Trình tự và tiêu chí hoàn thành

### P0 — Khóa đặc tả (coordinator)
Đọc tài liệu dự án, viết bốn tài liệu này và `AGENTS.md`, kiểm tra target không có code cần bảo toàn, xác nhận model chính xác.

Hoàn thành khi: mọi trạng thái UI và endpoint có định nghĩa; tên/tham số không còn do hai agent tự chọn riêng.

### P1F — Frontend (song song P1B)
1. Tạo Next.js với scripts dev/build/start/lint/typecheck/test, `.env.example`, lockfile.
2. Dựng layout editor và empty state theo frontend spec.
3. Viết types và HTTP client khớp contract; fetch catalog/health thực, không hardcode catalog thay cho backend.
4. Làm upload/preview, xử lý race, thông báo lỗi và thay ảnh.
5. Làm controls, history cấu hình, zoom/fit/pan; nút xử lý/AI gửi request thật.
6. Dựng empty result và AI states, khóa các thao tác chưa có dữ liệu.
7. Chạy lint/typecheck/tests/build, sửa lỗi trước handoff.

Hoàn thành khi: có thể mở `/`, chọn ảnh trong canvas, nhận upload ID từ FastAPI, thay đổi tham số và nhận thông báo 501 từ request đúng cấu trúc; không điều hướng và không xuất hiện ảnh/AI giả.

### P1B — Backend (song song P1F)
1. Tạo app/settings và cấu hình CORS, `.env.example`, requirements.
2. Implement schemas/catalog đúng contract, errors nhất quán.
3. Implement upload/storage/read original an toàn và giới hạn tài nguyên.
4. Tạo modules thuật toán, pipeline và AI chỉ có stubs.
5. Expose process/advise/download với validation và lỗi 501 có chủ đích.
6. Viết tests bằng file ảnh tạo trong test, lưu vào temp path của test.
7. Chạy tests trong virtualenv riêng trước handoff.

Hoàn thành khi: từng endpoint đáp ứng đúng contract, upload/read dùng được, lỗi sai đầu vào có kiểm thử, mọi algorithm/pipeline/AI stub được chứng minh không thực thi xử lý.

### P2 — Ghép nối (coordinator)
1. Đọc handoff và thay đổi thực tế, xác minh không lấn quyền sở hữu/scope.
2. Chạy lại backend tests và frontend checks.
3. Mở backend và frontend, kiểm tra bằng browser ở desktop và màn hình hẹp.
4. Kiểm tra request upload/process/advise thực tế, accessibility cơ bản và console errors.
5. Sửa lệch hợp đồng hoặc state race. Chỉ thay đổi đặc tả nếu cần và ghi rõ.
6. Viết README cách chạy trên Windows và cách bàn giao thuật toán.

Hoàn thành khi: checklist bên dưới được xác minh, không chỉ nhìn vào việc compile.

## 5. Checklist nghiệm thu bắt buộc

- [x] `/` đã là editor với header, canvas/dropzone, sidebar và footer.
- [x] Upload và thay ảnh không đổi URL/không remount sang trang khác.
- [x] Backend offline vẫn thấy editor; lỗi có thông báo và có đường thử lại.
- [x] Chỉ nhận một JPG/PNG; lỗi không làm hỏng ảnh hiện có.
- [x] Preview local và upload server có trạng thái phân biệt rõ.
- [x] Thay ảnh xóa history/config/result thuộc ảnh cũ; response muộn của ảnh cũ bị bỏ qua.
- [x] Đủ tám nhóm; Median/Bilateral là hai lựa chọn của một nhóm, không thành chín chức năng.
- [x] Metadata/range/default tham số lấy từ catalog, không có hai bộ giá trị độc lập.
- [x] Đổi tham số không tự gọi process hoặc tự làm ảnh đổi màu/sáng.
- [x] Undo chỉ undo cấu hình; reset dùng giá trị mặc định của catalog.
- [x] Process nhận đúng thứ tự và tham số; HTTP 501 hiển thị 'chưa triển khai', không báo thành công.
- [x] AI cần ảnh đã upload; không có câu trả lời hay đề xuất mẫu.
- [x] Chưa có result thì download và trước–sau không hoạt động.
- [x] Original bytes được bảo toàn, không ghi đè ảnh gốc.
- [x] Sai file, sai schema, ID lạ, CORS và size limit được kiểm thử.
- [x] Responsive không làm sidebar hoặc nút chính tràn màn hình.
- [x] Build/lint/typecheck/frontend tests/backend tests có kết quả bàn giao rõ.

Kết quả và cách xác minh: [verification.md](verification.md). Checklist này nghiệm thu scaffold, không phải nghiệm thu chất lượng thuật toán chưa được triển khai.

## 6. Dừng mở rộng

Không bổ sung auth, database, queue/job worker, Docker, proxy Next API, cloud storage, telemetry, chat persistence hay thư viện xử lý ảnh frontend. Những thứ này không cần để chứng minh scaffold. Một vấn đề làm chệch đặc tả phải được báo lên coordinator, không tự giải quyết bằng tính năng mới.
