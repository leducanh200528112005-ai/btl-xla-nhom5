# Resim

Frontend trình chỉnh ảnh cũ và khung FastAPI để chia việc cho nhóm BTL Xử lý ảnh.

**Hiện tại:** đã ghép giảm ố vàng (Lab), tô màu (ECCV16 CPU) và upscale 2×/4× (Lanczos) với frontend: xử lý, xem kết quả, so sánh và tải PNG thật. Phần người 1/2 và AI chưa bật trong pipeline, trả `501 NOT_IMPLEMENTED`. Xem [bàn giao người 3/4](backend/IMPLEMENTATION.md).

## Giao diện

Mở `/` là vào editor: vùng upload/ảnh bên trái, sidebar **Công cụ / AI tư vấn** bên phải. Upload và thay ảnh diễn ra trong cùng màn hình, không có landing page hay bước chuyển sang editor.

Frontend dùng **Next.js + TypeScript + Tailwind CSS**. Backend dùng **FastAPI + Pydantic**. Chưa cần tài khoản, database hoặc GPU để chạy khung này.

## Yêu cầu

- Node.js 22 và npm.
- Python 3.12.
- Hai terminal: một chạy backend, một chạy frontend.

Các lệnh bên dưới dùng PowerShell trên Windows. Thay đường dẫn thư mục nếu bạn đặt dự án ở nơi khác. Dùng `npm.cmd` để tránh vấn đề execution policy của `npm.ps1`.

## 1. Chạy backend

Mở terminal tại `backend`:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-dev.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe scripts/download_colorization.py
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Chỉ cần tạo virtualenv, cài dependencies và copy env ở lần đầu; không ghi đè `.env` bạn đã sửa.

- Health: <http://127.0.0.1:8000/api/health>
- Tài liệu API: <http://127.0.0.1:8000/docs>
- Ảnh gốc được lưu cục bộ, mặc định trong `backend/.storage`; không đưa thư mục này lên git.
- Giới hạn mặc định: 10 MiB/file, 20 triệu pixel; ảnh tạm có TTL 24 giờ.

## 2. Chạy frontend

Mở terminal khác tại `frontend`:

```powershell
npm.cmd ci
Copy-Item .env.example .env.local
npm.cmd run dev
```

Mở <http://localhost:3000>. Biến `NEXT_PUBLIC_API_BASE_URL` trong `.env.local` phải trỏ tới backend, mặc định `http://127.0.0.1:8000`. Thay biến public cần khởi động lại frontend; khi build production, giá trị được nhúng lúc build.

## 3. Cách kiểm tra khung hoạt động

1. Vào `/`: đã thấy editor và vùng chọn/kéo thả ảnh.
2. Chọn một JPG/PNG nhỏ: preview xuất hiện ngay, backend nhận ảnh và trả ID.
3. Bật một chức năng, chỉnh tham số: ảnh gốc vẫn giữ nguyên vì chưa xử lý.
4. Bật Giảm ố vàng, Tô màu ảnh hoặc Nâng độ phân giải rồi nhấn **Xử lý ảnh**. Backend chạy các bước và trả PNG kết quả. Các công cụ còn lại vẫn trả 501 nếu được chọn.
5. Chuyển tab **AI tư vấn**, nhập yêu cầu: backend cũng trả thông báo chưa triển khai, không có lời tư vấn mẫu.
6. **Tải kết quả**, **So sánh** và **Kết quả** được mở sau khi xử lý thành công. Thay đổi cấu hình xóa kết quả cũ để tránh nhầm thông số.
7. Đổi ảnh ngay trong editor: không đổi URL; cấu hình/lịch sử/kết quả của ảnh cũ được xóa.

Undo hiện chỉ hoàn tác **cấu hình**, không hoàn tác phiên bản ảnh.

## 4. Kiểm thử

Trong `backend`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Trong `frontend`:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
```

## 5. Bàn giao cho thành viên làm thuật toán

Đọc [hợp đồng API](docs/api-contract.md) và [bàn giao người 3/4](backend/IMPLEMENTATION.md). Các hàm của người 1/2 được giữ nguyên; chỉ ba thuật toán đã triển khai trong đợt này được đăng ký trong pipeline.

Ảnh nội bộ là NumPy uint8 BGR, không sửa đầu vào. Thành viên tiếp theo cần kiểm thử thuật toán của mình, thêm vào registry pipeline và đổi status trong catalog; các tham số hiện có giữ theo hợp đồng. AI advisor vẫn là stub.

## Tài liệu triển khai

- [Kế hoạch, phân công và checklist](docs/implementation-plan.md)
- [Đặc tả giao diện và state](docs/frontend-spec.md)
- [Hợp đồng endpoint và tham số](docs/api-contract.md)
- [Đặc tả backend và phần cần implement](docs/backend-spec.md)
- [Kết quả kiểm thử và kiểm tra giao diện](docs/verification.md)

Không dùng thư mục `CODE BTL` bên cạnh: mã nguồn của đợt triển khai này nằm trong **`CodeBTL`**.
