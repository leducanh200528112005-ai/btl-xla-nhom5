# Resim frontend — đặc tả triển khai

> Cập nhật 2026-11-06: theo yêu cầu mới, triển khai và ghép FE/BE cho người 3/4 (giảm ố vàng, tô màu ECCV16, upscale Lanczos), giữ người 1/2 và AI ngoài pipeline. Dùng thư mục backend/, frontend/ tại gốc repo theo xác nhận người dùng. Phần scaffold dưới đây là kế hoạch ban đầu; các yêu cầu giữ ba thuật toán/pipeline/kết quả là stub đã được thay thế bởi [hợp đồng hiện tại](api-contract.md) và [bàn giao](../backend/IMPLEMENTATION.md).

Đọc cùng `api-contract.md`. Task ownership: chỉ tạo/sửa `frontend/**`. Mục tiêu là editor tinh gọn, có chủ đích về thiết kế; không phải dashboard template hoặc landing page.

## 1. Nền tảng và cấu trúc

- Next.js App Router, TypeScript strict, Tailwind CSS; chọn phiên bản stable có thực trên npm, tương thích Node 22, ghi lockfile.
- `src/app/page.tsx` render editor tại `/`. `layout.tsx` chứa metadata và global styles. Các phần có state/file/blob dùng client modules.
- Suggested folders: `components/ui/`, `features/editor/`, `features/tools/`, `features/advisor/`, `services/`, `types/`, `lib/`.
- React reducer/hooks/context đủ dùng. Không cần Redux, Zustand, Fabric, Konva, AI SDK hay thư viện xử lý ảnh.
- `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000` trong `.env.example`; lỗi cấu hình hiện rõ thay vì fallback sang mock. Có thể dùng default localhost tương ứng contract cho dev.
- HTTP client là nơi duy nhất fetch/join base URL/parse errors; hỗ trợ AbortSignal.
- `<img>` có alt được phép cho blob/user image; cấu hình lint phù hợp nếu cần. Không dùng remote font bắt buộc khi build; dùng system sans hỗ trợ tiếng Việt.
- Scripts: dev, build, start, lint, typecheck, test. Unit tests nhỏ cho reducer/serialization/error handling bằng Vitest hoặc tương đương.

## 2. Layout desktop

Editor chiếm viewport, không có thanh điều hướng marketing.

```
+-----------------------------------------------------------+
| Resim / Khôi phục ảnh    tên ảnh     Đổi ảnh   Tải kết quả |
+-------------------------------------+---------------------+
|                                     | Công cụ | AI tư vấn |
|                                     +---------------------+
|       CANVAS / UPLOAD EMPTY STATE    |                     |
|                                     |    nội dung cuộn    |
|       ảnh là trọng tâm              |       độc lập       |
|                                     |                     |
|                                     +---------------------+
|                                     | Đặt lại | Xử lý ảnh |
+-------------------------------------+---------------------+
| metadata ảnh   trạng thái   -  zoom  +  Vừa khung  Undo    |
+-----------------------------------------------------------+
```

- Header cao khoảng 64–72px; footer khoảng 48–56px; sidebar 360px ở desktop, có thể 340px ở viewport 1024px.
- Canvas chiếm không gian còn lại, có margin/padding thoáng. Không đặt hai panel nổi chặn hai bên ảnh kiểu Squoosh.
- Nền than tối, panel sáng hơn một chút, border tinh tế, accent teal/cyan một màu chủ đạo. Gợi ý tokens: background #101315, panel #181D20, elevated #20272B, border #2C363B, text #EDF3F5, muted #96A7AF, accent #4DD9C0. Có thể tinh chỉnh tương phản nhưng không đổi phong cách.
- Không dùng gradient lớn, glow dày, bảng thống kê hoặc ảnh trang trí. Logo chữ Resim với mark đơn giản; icon Lucide đồng bộ. Chữ thân khoảng 14px, nhãn dễ đọc và có dấu tiếng Việt.
- Một thông báo nhỏ 'Bản khung phát triển · Thuật toán chưa triển khai' là đủ; không phủ banner lớn làm mất vùng ảnh.
- Canvas neutral, không áp filter lên original. Grid/checker nhẹ có thể dùng cho vùng trống/transparency.

## 3. Empty state là upload trong editor

Vào `/` đã thấy toàn bộ chrome editor, sidebar các tên công cụ và footer. Canvas giữa có dropzone rộng gồm icon upload, tiêu đề `Bắt đầu với bức ảnh của bạn`, mô tả ngắn, nút `Chọn ảnh`, ghi chú JPG/PNG · tối đa 10 MB. Không có CTA 'Bắt đầu' để mở editor.

Sidebar có tám nhóm nhìn thấy được; controls bị khóa đến khi ảnh upload thành công và catalog đã tải. Hai tab có thể đổi để đọc empty guidance. Header `Đổi ảnh` có thể là `Chọn ảnh` ở trạng thái trống. Download, compare, undo, zoom chưa có ảnh thì disabled.

## 4. Upload state machine và độ an toàn state

State tối thiểu: selected file/preview URL, uploaded ImageAsset hoặc null, upload status, catalog status, editor config/history, zoom/pan, active sidebar tab, process status, advise status, real result/null và proposal/null.

Trình tự:
1. File picker hoặc drop vào canvas; chỉ đúng một JPEG/PNG. Kiểm tra file.size, chữ ký nội dung và khả năng decode cơ bản ở client; định dạng do nội dung quyết định, không từ chối byte JPEG/PNG hợp lệ chỉ vì extension hoặc File.type khác. Thuộc tính accept chỉ là gợi ý của file picker; server là nguồn xác thực cuối.
2. Nếu file mới invalid, báo lỗi và giữ ảnh/cấu hình đang có.
3. Khi file mới valid và chọn thành công: hủy request upload/process/advise cũ, tăng generation token, thay local preview, clear uploaded ID/result/proposal, reset config/history/zoom. Không đổi route hoặc reload trang.
4. Local preview xuất hiện ngay, badge `Đang tải ảnh lên…`; gọi upload thực.
5. Upload thành công đúng generation thì ghi metadata/image_id, đổi trạng thái `Ảnh gốc`, mở controls nếu catalog sẵn sàng.
6. Upload lỗi vẫn giữ local preview, ghi rõ `Chưa tải lên backend`, có `Thử tải lại`; không cho process/advise vì chưa có ID.
7. Mọi response muộn của generation cũ phải bị bỏ qua. AbortController không thay thế hoàn toàn generation check.

Revoke object URLs khi thay ảnh/unmount, không revoke preview hiện đang dùng. Chọn lại cùng file vẫn hoạt động. Kéo thả không làm browser navigate tới file. Không dùng localStorage lưu file/ảnh/API response. Không có seed image.

Backend offline: shell vẫn render, health/catalog error hiện ngắn gọn có nút thử kết nối lại. User có thể chọn và xem ảnh local, nhưng controls/request cần backend vẫn khóa; không invent catalog fallback.

## 5. Sidebar Công cụ

Thứ tự hiển thị cố định (theo cách người dùng tìm công cụ, khác thứ tự thực thi):
1. Khử nhiễu
2. Điều chỉnh độ sáng
3. Tăng tương phản
4. Làm sắc nét
5. Giảm vết xước
6. Giảm ố vàng
7. Tô màu ảnh
8. Nâng độ phân giải

Mỗi nhóm có icon, tên, switch enabled và accordion mở tham số. Ban đầu tất cả disabled theo cấu hình (switch off), một nhóm có thể mở để hướng dẫn. Accordion và switch là hai nút độc lập, không tạo button lồng button. Header nhóm vẫn nhìn thấy khi backend chưa có; không có params giả.

- Catalog trả descriptor; dùng descriptor để tạo input, range, options, default và tooltip. Constants UI chỉ giữ thứ tự, label nhóm, icon; không nhân đôi range/default.
- Denoise chọn Median/Bilateral trong cùng nhóm. Giữ params theo từng algorithm khi đổi lựa chọn; chỉ serialize phương pháp đang chọn nếu nhóm bật.
- `kind=number`: slider và input số liên kết. Cho phép input đang gõ tạm thời, chỉ commit giá trị hợp lệ khi blur/Enter; không đưa NaN/string vào payload.
- `kind=select`: select/segmented phù hợp; scale hiển thị 2× / 4×. Giá trị DOM của native select là string: chuyển sang number và kiểm tra nằm trong options trước khi commit. Tests phải xác nhận kernel_size/diameter/scale trên payload là số, không phải chuỗi.
- Hiển thị giá trị có đơn vị thích hợp, giải thích Gamma/CLAHE đúng contract. Nhãn 'Chưa triển khai' nhỏ, không làm người dùng hiểu slider đã tác động lên ảnh.
- Chỉnh tham số chỉ đổi draft. Không gọi process mỗi lần kéo; không CSS filter để giả preview.
- Nhóm chưa bật có thể xem params, controls edit được khi có ảnh/catalog; serialization chỉ lấy nhóm bật.
- `Đặt lại`: reset config theo catalog + tất cả switches off; ghi vào history như một thay đổi nếu có khác biệt.
- Undo (redo optional): chỉ history config, cap khoảng 50 entries; gộp một lần kéo slider thành một history entry. Không cướp Ctrl+Z của text/number input.

Footer sidebar luôn nhìn thấy, không bị cuộn mất: `Đặt lại` và `Xử lý ảnh`. Nút process enabled khi có uploaded ID, catalog, ít nhất một group bật và không có request xung đột; việc status thuật toán là not_implemented không chặn gửi request thử khung. Khi nhấn: serialize đúng thứ tự API contract, POST thật, hiển thị lỗi 501 trung tính 'Chức năng xử lý ảnh chưa được triển khai.' Không toast thành công.

## 6. Canvas và kết quả

- Chỉ local preview/original khi chưa có result; nhãn `Ảnh gốc` và thông tin file.
- Zoom +/-/fit, pan khi zoom lớn; giữ ảnh trong canvas, không cho ảnh tràn đè sidebar. Fit theo viewport và image aspect. Dùng CSS transform/DOM; không dùng canvas để reencode.
- Nếu có UI lựa chọn `Gốc / So sánh / Kết quả`, hai lựa chọn sau disabled khi result=null. Giải thích bằng tooltip hoặc chú thích; không duplicate original thành hai nửa so sánh.
- Có thể tạo comparison view nhận originalUrl/resultUrl cho giai đoạn sau, nhưng không dựng state success bằng fixture. Khi result thật xuất hiện sau này, hai ảnh phải dùng cùng viewport chuẩn hóa để xử lý trường hợp upscale khác pixel size.
- `Tải kết quả` disabled khi result=null; HTTP client vẫn có method download để bàn giao. Không tải original dưới tên 'đã khôi phục'.
- Footer metadata không suy đoán ảnh đã upscale; hiển thị kích thước original nhận từ server, hoặc 'Ảnh xem trước' trước upload.

## 7. Tab AI tư vấn

- Bảng tư vấn có cấu trúc, không làm chatbot giả.
- Gợi ý chữ tĩnh giải thích AI sẽ nhận xét ảnh và đề xuất thông số; không trình bày gợi ý đó như câu trả lời của AI.
- Textarea request, counter max 2000, nút `Phân tích ảnh` cần uploaded ID và prompt không rỗng. Gửi steps hiện tại, current_result_id=null.
- Loading rõ ràng; 501 hiển thị đúng message và giữ nội dung người dùng để sửa/gửi lại.
- Chỗ nhận xét/steps/áp dụng chỉ render khi có proposal thật. Áp dụng về sau phải kiểm tra thuật toán/params khớp catalog, chuyển thành một history entry; không tự process.
- Thay ảnh xóa proposal và kết quả request cũ, tránh đề xuất cho nhầm ảnh.

## 8. Responsive và accessibility

- Desktop >=1024px: hai cột; header/sidebar/footer không tràn. Canvas là phần co giãn, không sidebar dãn tùy nội dung.
- Tablet/mobile <1024px: canvas trên, panel Công cụ/AI dưới (có thể scroll trang); không giữ fixed sidebar rộng 360px làm ngang màn hình. Giữ upload cùng route. Ở 390px nút/tabs/input dùng được và không horizontal overflow.
- Input có label, switch có role/aria, loading có aria-live phù hợp, disabled dùng thật. Focus visible, contrast tốt, điều hướng keyboard được. Không chỉ dùng màu để thông báo lỗi.
- Error cho upload/process/AI nằm đúng vùng tương ứng; lỗi mạng không biến thành 'chưa triển khai'.

## 9. Tests và handoff

Test tối thiểu: serializer bỏ tool off và order đúng, không serialize hai denoise; reducer history/reset; thay ảnh clear state; parsing lỗi API (501 vs network). Chạy lint/typecheck/test/build. Handoff liệt kê files chính, lệnh đã chạy, API assumptions, limitations. Không mở dev server background để tránh xung đột coordinator; coordinator sẽ chạy browser kiểm tra.
