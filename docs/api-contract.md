# Resim HTTP contract — triển khai người 3/4

Cập nhật 2026-11-06 theo yêu cầu triển khai giảm ố vàng, tô màu, upscale và ghép FE/BE. Giữ nguyên identifier, tham số, thứ tự bước và shape kết quả đã chốt; mở trạng thái `implemented`, phản hồi thành công, kho kết quả và lỗi mô hình như bên dưới. Người 1/2 và AI chưa được bật trong pipeline này.

Nguồn chuẩn chung cho frontend/backend. JSON dùng snake_case; UI có thể chuyển đổi state nội bộ nhưng payload phải giữ các tên bên dưới. Base URL mặc định `http://127.0.0.1:8000`; tất cả route bắt đầu `/api`.

## 1. Quy tắc chung

- Backend trả JSON, trừ route phục vụ/download ảnh. Frontend dùng `NEXT_PUBLIC_API_BASE_URL`, không hardcode host ở module UI.
- Mọi URL ảnh do server trả là path tương đối, ví dụ `/api/images/{image_id}`. HTTP client nối với base URL tại một chỗ.
- `image_id`/`result_id` là UUID v4 dạng string. Không nhận đường dẫn filesystem từ client.
- Các schema reject trường không biết. Kiểu số tham số không nhận string hoặc boolean; integer phải là số nguyên. Request có tham số hợp lệ không có nghĩa thuật toán đã được triển khai.
- Không cần cookie/token. CORS allow frontend `http://localhost:3000` và `http://127.0.0.1:3000`, cấu hình được qua env.
- Lỗi dùng envelope thống nhất:

```json
{"error":{"code":"NOT_IMPLEMENTED","message":"Chức năng xử lý ảnh chưa được triển khai.","details":null}}
```

`details` là null hoặc danh sách `{field: string, message: string}`. Không gửi exception/traceback/file path nội bộ.

| HTTP | error.code | Ý nghĩa |
|---|---|---|
| 404 | IMAGE_NOT_FOUND | UUID ảnh hợp lệ nhưng không có/đã hết hạn |
| 413 | FILE_TOO_LARGE | Vượt giới hạn byte |
| 415 | UNSUPPORTED_IMAGE | Dữ liệu không phải JPEG/PNG hợp lệ, kể cả giả extension/MIME |
| 422 | VALIDATION_ERROR | Thiếu/trường lạ/tham số sai/UUID sai/danh sách bước sai |
| 422 | IMAGE_TOO_LARGE | Vượt giới hạn số pixel |
| 501 | NOT_IMPLEMENTED | Đầu vào hợp lệ, tính năng chỉ có khung |
| 503 | MODEL_UNAVAILABLE | Thiếu hoặc không đọc được trọng số mô hình tô màu |
| 503 | PROCESSING_BUSY | Tiến trình backend đang xử lý một ảnh khác, thử lại sau |
| 500 | INTERNAL_ERROR | Lỗi hạ tầng không mong đợi, thông báo an toàn |

## 2. GET /api/health

200: `{"status":"ok","app":"resim","version":"0.1.0"}`.

## 3. GET /api/algorithms

200: `{ "items": AlgorithmDescriptor[] }`. Thứ tự item: median, bilateral, gamma, CLAHE, unsharp, scratches, yellowing, colorize, upscale. Có chín thuật toán nhưng chỉ tám nhóm công cụ.

```ts
type ToolId = 'denoise' | 'brightness' | 'contrast' | 'sharpen' |
  'scratches' | 'yellowing' | 'colorize' | 'upscale';

type ParameterDescriptor = {
  key: string;
  label: string;
  description: string;
  kind: 'number' | 'select';
  default: number;
  integer: boolean;
  min: number | null;
  max: number | null;
  step: number | null;
  options: {value: number; label: string}[];
};
type AlgorithmDescriptor = {
  id: string;
  tool_id: ToolId;
  name: string;
  description: string;
  implementation_status: 'not_implemented' | 'implemented';
  params: ParameterDescriptor[];
};
```

Tên hiển thị/description tiếng Việt. `remove_yellow_cast`, `colorize_image`, `upscale_image` có status `implemented`; các thuật toán khác vẫn `not_implemented`. Status mô tả code đã được ghép vào pipeline, không thay thế kiểm tra tài nguyên runtime: tô màu strength > 0 cần trọng số cục bộ, thiếu/hỏng trả 503. `kind=select` dùng options và min/max/step=null. `kind=number` có min/max/step và options=[]. `integer` luôn có.

### Thuật toán và tham số chuẩn

Các cột range/step/default là giới hạn của scaffold đã thống nhất. Thuật toán/mô hình thực tế được chọn sau phải được kiểm tra lại trước khi chuyển status thành đã triển khai; không bổ sung các tham số mô hình tưởng tượng.

| tool_id | algorithm id | Tham số (kiểu, range hoặc options, step, default) |
|---|---|---|
| denoise | denoise_median | kernel_size: integer select {3,5,7}, default 3 |
| denoise | denoise_bilateral | diameter: integer select {5,7,9}, default 5; sigma_color: number 1..150 step 1 default 50; sigma_space: number 1..150 step 1 default 50 |
| brightness | adjust_gamma | gamma: number 0.1..3 step 0.05 default 1 |
| contrast | enhance_clahe | clip_limit: number 0.1..10 step 0.1 default 2; tile_grid_size: integer 2..16 step 1 default 8 |
| sharpen | sharpen_unsharp | amount: number 0..3 step 0.05 default 0.8; sigma: number 0.1..5 step 0.1 default 1 |
| scratches | reduce_scratches | sensitivity: number 0..1 step 0.05 default 0.5; inpaint_radius: integer 1..10 step 1 default 3 |
| yellowing | remove_yellow_cast | strength: number 0..1 step 0.05 default 0.5 |
| colorize | colorize_image | strength: number 0..1 step 0.05 default 1 |
| upscale | upscale_image | scale: integer select {2,4}, default 2 |

`tile_grid_size` là số ô trên MỖI chiều của lưới vuông, không phải số pixel; implementation sau chuyển integer thành `(n,n)`. `gamma` theo quy ước `out = in^(1/gamma)`, >1 sáng hơn.

Ngữ nghĩa tham số:
- `remove_yellow_cast.strength`: 0 giữ ảnh gốc, 1 dùng đầy đủ kết quả giảm ám vàng của thuật toán được chọn; khoảng giữa trộn theo mức đó.
- `colorize_image.strength`: 0 giữ bản đầu vào, 1 dùng đầy đủ kết quả tô màu; đây là mức trộn của wrapper, không phải tham số nội bộ của mô hình.
- `sensitivity`: càng lớn thì phát hiện vết xước càng nhạy, có nguy cơ nhận nhầm càng cao. Nhóm thuật toán phải thử nghiệm/chốt mapping sang threshold/morphology trước khi công bố chức năng hoàn tất; contract không giả định một công thức phát hiện đã tồn tại.
- Thông số morphology chi tiết nằm nội bộ. Không có trường mask do client cung cấp.

## 4. POST /api/upload

Request `multipart/form-data`, một field `file` duy nhất, là một JPG/PNG. Frontend dùng FormData và để browser tự đặt Content-Type/boundary.

- Default MAX_UPLOAD_BYTES = 10 * 1024 * 1024.
- Default MAX_IMAGE_PIXELS = 20_000_000.
- Server xác thực định dạng bằng nội dung; không tin MIME hoặc tên file.
- Vượt pixel cap cấu hình, kể cả Pillow báo decompression bomb trong khi mở ảnh, trả `422 IMAGE_TOO_LARGE`. File hỏng/định dạng ngoài JPEG/PNG trả `415 UNSUPPORTED_IMAGE`; không gom mọi lỗi Pillow thành cùng một mã.
- Giữ nguyên bytes, không resize/rotate/reencode. width/height là kích thước lưu trong file; browser hiển thị orientation theo metadata.
- File phải đọc được/verify được bằng Pillow. Một file 0 byte hoặc file hỏng trả 415.

201:

```json
{
  "image_id":"84e83523-9630-4de8-921e-daf875724d6d",
  "filename":"anh-gia-dinh.jpg",
  "content_type":"image/jpeg",
  "size_bytes":123456,
  "width":2048,
  "height":1536,
  "url":"/api/images/84e83523-9630-4de8-921e-daf875724d6d"
}
```

Chỉ `filename` là tên hiển thị gốc, được làm sạch basename. Đường lưu do server sinh từ UUID. Không cần trường timestamp ở frontend.

## 5. GET /api/images/{image_id}

200: bytes ảnh gốc, Content-Type đúng JPEG/PNG. 404 nếu ảnh không còn. UUID không hợp lệ trả 422. Không expose thư mục lưu bằng static mount toàn bộ. Không xử lý ảnh trong endpoint này.

## 6. Steps — dùng chung process và advise

```ts
type ProcessingStep = {
  algorithm: string; // Một trong chín id catalog
  params: Record<string, number>;
};
```

Params dùng đúng key trong bảng; backend điền default khi một key đã biết bị bỏ qua, reject key lạ. Frontend gửi đủ key của thuật toán đang chọn. Strict number validation và range validation ở backend là bắt buộc; float step dùng cho UI, không bắt lỗi số chỉ vì không đúng bội của step.

- Tối đa 8 bước, tối đa một bước cho mỗi tool_id.
- Hai phương pháp denoise không được xuất hiện đồng thời.
- Không lặp algorithm/tool.
- Backend bảo toàn thứ tự request, không tự reorder.
- Nếu có upscale thì upscale phải là bước cuối.
- Frontend tạo thứ tự cố định: scratches → denoise → yellowing → brightness → contrast → colorize → sharpen → upscale; bỏ tool chưa bật.

Ví dụ:
```json
{"image_id":"84e83523-9630-4de8-921e-daf875724d6d","steps":[{"algorithm":"denoise_median","params":{"kernel_size":3}},{"algorithm":"adjust_gamma","params":{"gamma":1.2}}]}
```

## 7. POST /api/process

Request: `{image_id: UUID4, steps: ProcessingStep[]}`. `steps` cần ít nhất 1 phần tử. Validate schema, kiểm tra ảnh tồn tại và toàn bộ bước trước xử lý. Nếu có bước ngoài ba thuật toán đã ghép thì trả 501, không bỏ qua bước hoặc lưu kết quả một phần.

200 khi tất cả bước hoàn tất và PNG kết quả đã được lưu. Luôn bắt đầu từ ảnh gốc, áp dụng EXIF orientation trên bản giải mã để khớp preview trình duyệt, giữ bytes gốc. Giữ alpha PNG, upscale alpha cùng kích thước. Giới hạn đầu ra `RESIM_MAX_RESULT_PIXELS` mặc định 32 triệu pixel, kiểm tra trước cấp phát; vượt trả 422 `IMAGE_TOO_LARGE`. Upscale là Lanczos CPU 2×/4×, không phải AI super-resolution. Giảm ám vàng dùng Lab, tô màu dùng ECCV16 CPU; strength 0 giữ đúng pixel đầu vào.

Mỗi tiến trình xử lý tối đa một request tại một thời điểm, request khác trả 503 `PROCESSING_BUSY`. Thiếu/hỏng model trả 503 `MODEL_UNAVAILABLE`; lỗi không sinh kết quả thành công.

Response 501: envelope NOT_IMPLEMENTED, message `Chức năng xử lý ảnh chưa được triển khai.`

Shape thành công (URL tương đối `/api/results/{result_id}`, PNG không mất dữ liệu):
```ts
type ProcessResult = {
  result_id: string;
  image_id: string;
  filename: string;
  content_type: 'image/jpeg' | 'image/png';
  size_bytes: number;
  width: number;
  height: number;
  url: string;
};
```

## 8. POST /api/advise

Request:
```json
{"image_id":"84e83523-9630-4de8-921e-daf875724d6d","prompt":"Ảnh hơi tối, tôi muốn giữ vẻ tự nhiên.","steps":[],"current_result_id":null}
```

- `prompt`: trim, 1..2000 ký tự.
- `steps`: cùng định nghĩa, 0..8 phần tử, có thể gửi cấu hình hiện tại.
- `current_result_id`: UUID4 hoặc null, default null; đợt này chưa có result nên gửi null.
- Validate và kiểm tra ảnh tồn tại, sau đó 501 message `Chức năng AI tư vấn chưa được triển khai.`
- Không gọi model, không trả canned analysis/steps.

Shape thành công TƯƠNG LAI: `{analysis: string, steps: Array<ProcessingStep & {reason: string}>}`. Frontend có thể chuẩn bị kiểu dữ liệu và chỗ hiển thị, nhưng chỉ render đề xuất khi response thật tồn tại.

## 9. GET /api/download/{result_id}

200: bytes PNG đã xử lý, `Content-Disposition: attachment` với filename từ metadata. UUID sai: 422. ID không tồn tại/hết hạn hoặc dùng ID ảnh gốc: 404 `IMAGE_NOT_FOUND`. Kết quả lưu riêng trong `.storage/results`, TTL 24 giờ từ lúc tạo; không thay thế ảnh gốc.

### GET /api/results/{result_id}

200: cùng bytes PNG như download, hiển thị inline để so sánh/xem kết quả. UUID sai 422, ID thiếu/hết hạn 404 `IMAGE_NOT_FOUND`. URL do `/api/process` trả; không mount thư mục storage. Cả hai endpoint có `Cache-Control: private, no-store` và `X-Content-Type-Options: nosniff`.

## 10. Đường giao tiếp duy nhất

Next.js fetch trực tiếp FastAPI theo env; không thêm route `/api/*` trong Next làm proxy. Health/catalog/upload/process/results/download trả dữ liệu thật. Advise vẫn trả 501. Có thể mở FastAPI `/docs` để bàn giao cho nhóm.
