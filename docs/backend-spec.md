# Resim backend — đặc tả triển khai

> Cập nhật 2026-11-06: theo yêu cầu mới, triển khai và ghép FE/BE cho người 3/4 (giảm ố vàng, tô màu ECCV16, upscale Lanczos), giữ người 1/2 và AI ngoài pipeline. Dùng thư mục backend/, frontend/ tại gốc repo theo xác nhận người dùng. Phần scaffold dưới đây là kế hoạch ban đầu; các yêu cầu giữ ba thuật toán/pipeline/kết quả là stub đã được thay thế bởi [hợp đồng hiện tại](api-contract.md) và [bàn giao](../backend/IMPLEMENTATION.md).

Đọc `api-contract.md` trước. Task ownership: chỉ tạo/sửa `backend/**`. Backend là hạ tầng hoạt động + interface cho công việc thuật toán về sau, không phải bộ xử lý ảnh hoạt động.

## 1. Tổ chức module

```
backend/
  app/
    __init__.py
    main.py
    config.py
    errors.py
    api/                # health, algorithms, images/upload, process, advise/download
    schemas/            # catalog, params, requests, responses
    catalog.py          # nguồn metadata + defaults + ranges duy nhất
    pipeline.py         # stub
    algorithms/
      __init__.py
      denoise.py
      brightness.py
      contrast.py
      sharpen.py
      scratches.py
      yellowing.py
      colorize.py
      upscale.py
    services/
      image_storage.py  # thật
      ai_advisor.py     # stub
  tests/
  requirements.txt
  requirements-dev.txt
  .env.example
```

Có thể gộp route/schema file nếu hợp lý, tránh lớp chỉ pass-through. Giữ module catalog/validation/storage tách khỏi algorithm implementations để app khởi động không cần OpenCV/Torch/trọng số.

## 2. Dependencies và cấu hình

- Python 3.12. FastAPI, uvicorn, Pydantic v2, python-multipart, Pillow; pydantic-settings/python-dotenv nếu cần. NumPy được phép cho type alias ảnh; không cài OpenCV/Torch/model SDK.
- Dev: pytest, httpx; dùng virtualenv `backend/.venv` và chạy tests bằng python trong venv đó. Ghi requirements tái lập hợp lý.
- Env: `RESIM_STORAGE_DIR` default `backend/.storage` dựa vào path project, `RESIM_MAX_UPLOAD_BYTES=10485760`, `RESIM_MAX_IMAGE_PIXELS=20000000`, `RESIM_IMAGE_TTL_HOURS=24`, `RESIM_CORS_ORIGINS` cấu hình được.
- `.env.example` không có secret. User-facing errors tiếng Việt, internal code tiếng Anh.
- `create_app(settings=None)` hoặc dependency seam tương đương để tests có temp storage/cấu hình riêng. Không hardcode storage vào cwd và không làm test ghi vào storage thật.

## 3. Catalog, schemas và validation

- Dùng bảng trong API contract chính xác cho chín algorithms/tám tool groups.
- Một nguồn định nghĩa default/range/options phải cung cấp cả catalog và runtime validation; không duy trì hai bảng tự do dễ lệch nhau. Có thể derive descriptor từ schema fields/metadata hoặc validate qua cùng registry.
- Schema algorithm params tương ứng, strict types, reject extras; unknown algorithm/param trả 422 chuẩn, không 500.
- Process/advise validate list length, duplicate tool, denoise exclusivity và upscale last trước khi trả 501.
- Image UUID v4 hợp lệ nhưng không tồn tại: 404; malformed UUID: 422.
- FastAPI validation handler chuyển lỗi sang envelope chuẩn, details không chứa dữ liệu nhị phân hoặc exception khó serialize.
- `GET /api/algorithms` là catalog thực và có thể test exact IDs/params. Các trạng thái luôn not_implemented.

## 4. Image storage thật, giới hạn rõ

Upload chỉ đọc tối đa giới hạn + 1 byte (hoặc chunk tương đương), không load file vô hạn vào RAM. Đóng UploadFile đúng lifecycle.

Trước khi ghi:
1. Kiểm tra byte limit và file không rỗng.
2. Dùng Pillow xác định JPEG/PNG, đọc kích thước, kiểm tra pixel limit và verify file thực. Pixel cap hoặc decompression-bomb warning/error khi mở ảnh trả 422 IMAGE_TOO_LARGE; ảnh hỏng/định dạng không hỗ trợ trả 415 UNSUPPORTED_IMAGE. Không tắt bảo vệ bomb một cách toàn cục.
3. Dùng UUID4 và extension do định dạng đã xác minh để sinh tên lưu; chỉ giữ original basename an toàn làm metadata display.
4. Lưu nguyên bytes, metadata JSON tối thiểu chứa thông tin asset/thời điểm tạo. Có thể atomic-write để tránh metadata mồ côi; khi lỗi ghi phải dọn đúng file mới tạo.

Storage chỉ phục vụ ID đã xác minh, không lấy filename/path client để truy cập filesystem. `GET /api/images/{id}` kiểm tra tồn tại/expiry, trả FileResponse media type chính xác và header an toàn; không expose toàn thư mục bằng mount.

TTL đơn giản 24h: kiểm tra khi đọc, dọn file do app sở hữu khi startup và/hoặc upload. Cleanup giới hạn trong RESIM_STORAGE_DIR với format file app tạo, không recursive delete thư mục ngoài. Không làm queue/background worker chỉ để cleanup.

Original không bị đổi bytes, orientation hay metadata. Không normalize/reencode/resize ở đợt này. Tests so sánh bytes upload và bytes GET phải bằng nhau.

## 5. Stubs bàn giao

Giữ quy ước image là NumPy uint8 array BGR, grayscale mask uint8 cùng kích thước; chỉ biểu diễn bằng type alias/annotations và docstrings. Không decode ảnh sang NumPy ở route process.

Các hàm cần có:
- `denoise_median(image, params)` và `denoise_bilateral(image, params)`.
- `adjust_gamma(image, params)`.
- `enhance_clahe(image, params)`.
- `sharpen_unsharp(image, params)`.
- `detect_scratches(image, params)` trả mask trong tương lai.
- `reduce_scratches(image, params)` tự tạo mask nội bộ trong tương lai; frontend không gửi mask.
- `remove_yellow_cast(image, params)`.
- `colorize_image(image, params)`.
- `upscale_image(image, params)`.
- `pipeline.process_image(original, steps)`.
- `ai_advisor.advise_image(...)` với original ID/data/cấu hình phù hợp contract.

Mỗi hàm có annotations, docstring mô tả input/output/params/invariants, rồi raise NotImplementedError. Không trả image.copy() hoặc image nguyên trạng dưới dạng kết quả đã xử lý. Không có cv2 call, LUT, morphology, model/API call hoặc fallback nội suy.

Route process/advise dùng helper NOT_IMPLEMENTED sau khi validation và kiểm tra ảnh, không cần gọi stub để tạo traceback. Download UUID hợp lệ trả 501. OpenAPI mô tả status 501 rõ ràng. Nếu khai báo response model thành công, vẫn phải giữ response lỗi đúng envelope.

## 6. Kiểm thử bắt buộc

Tạo JPEG/PNG nhỏ bằng Pillow trong tests; chỉ tests được dùng thao tác tạo ảnh. Temp paths và create_app settings độc lập.

1. health 200 đúng shape.
2. catalog đủ IDs, đúng tool groups/default/ranges/status; không lẫn chín chức năng.
3. JPG và PNG upload201, metadata đúng, GET trả cùng byte, đúng media type.
4. empty/fake/corrupt/unsupported ảnh →415, không để file mồ côi.
5. byte limit413 và pixel limit422 (test cấu hình limit thấp, không tạo ảnh lớn gây tốn RAM).
6. filename dạng traversal không ảnh hưởng đường ghi.
7. invalid UUID422, UUID hợp lệ không có404; asset hết hạn404.
8. process hợp lệ với ảnh tồn tại501, không result/file xử lý phát sinh.
9. gamma<=0, unknown keys/algorithm, string/bool thay số, median ngoài options, duplicate denoise/tool, upscale không cuối, steps rỗng →422.
10. advise hợp lệ501; prompt rỗng/quá dài và steps sai422; ảnh lạ404.
11. download UUID hợp lệ501, UUID sai422.
12. CORS preflight từ hai origins hợp lệ có header đúng; origin lạ không được allow.
13. Các algorithm/pipeline/AI stubs raise NotImplementedError trực tiếp.

## 7. Handoff

Báo số tests và lệnh đã chạy, cấu trúc files, env cần thiết và hạn chế. Không mở server background. Nếu phát hiện frontend cần trường khác hoặc đặc tả mâu thuẫn, báo coordinator; đừng tự sửa docs hay frontend.
