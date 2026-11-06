# Đối chiếu HTTP: frontend/src/services/api-client.ts và src/types/api.ts.
# health()/catalog(): Editor kiểm tra kết nối và lấy metadata cho ToolsPanel.
# upload(): FormData chỉ có file -> ImageAsset; image_id dùng cho process/advise.
# get_original(): trả bytes gốc qua URL tương đối; FE nối URL bằng apiClient.imageUrl().
# process(): chạy ba thuật toán người 3/4 và trả ProcessResult; bước khác trả 501.
# advise(): tab "AI tư vấn" gửi {image_id, prompt, steps, current_result_id: null}.
# download(): trả PNG đã xử lý qua result_id thật, không dùng image_id.
# Khi tích hợp thật cần trả ProcessResult đúng contract trước khi FE có thể hiện
# kết quả/so sánh/tải xuống; tuyệt đối không trả ảnh gốc như ảnh đã khôi phục.

"""Resim HTTP endpoints."""

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from pydantic import UUID4
from starlette.datastructures import UploadFile as StarletteUploadFile
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.catalog import catalog_descriptors
from app.errors import ApiError
from app.schemas.models import (
    AdviseRequest,
    CatalogResponse,
    ErrorResponse,
    HealthResponse,
    ProcessRequest,
    ProcessResultResponse,
    UploadResponse,
)
from app.services.image_storage import ImageStorage, validate_image_bytes
from app.services.processing import create_result

router = APIRouter(prefix="/api")


@router.get("/health", response_model=HealthResponse)
async def health() -> dict[str, str]:
    return {"status": "ok", "app": "resim", "version": "0.1.0"}


@router.get("/algorithms", response_model=CatalogResponse)
async def algorithms() -> dict[str, Any]:
    return {"items": catalog_descriptors()}


@router.post(
    "/upload",
    status_code=201,
    response_model=UploadResponse,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["file"],
                        "additionalProperties": False,
                        "properties": {"file": {"type": "string", "format": "binary"}},
                    }
                }
            },
        }
    },
    responses={
        413: {"model": ErrorResponse, "description": "Tệp vượt giới hạn dung lượng."},
        415: {"model": ErrorResponse, "description": "Tệp không phải JPEG/PNG hợp lệ."},
        422: {"model": ErrorResponse, "description": "Dữ liệu hoặc kích thước ảnh không hợp lệ."},
    },
)
async def upload(request: Request) -> dict[str, Any]:
    try:
        form = await request.form(max_files=2, max_fields=2, max_part_size=64 * 1024)
    except StarletteHTTPException:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "Tệp tải lên không đúng định dạng yêu cầu.",
            [{"field": "file", "message": "Gửi đúng một trường tệp có tên file."}],
        ) from None

    try:
        parts = form.multi_items()
        if len(parts) != 1 or parts[0][0] != "file" or not isinstance(parts[0][1], StarletteUploadFile):
            raise ApiError(
                422,
                "VALIDATION_ERROR",
                "Tệp tải lên không đúng định dạng yêu cầu.",
                [{"field": "file", "message": "Gửi đúng một trường tệp có tên file."}],
            )
        file = parts[0][1]
        settings = request.app.state.settings
        data = await file.read(settings.max_upload_bytes + 1)
        if len(data) > settings.max_upload_bytes:
            raise ApiError(413, "FILE_TOO_LARGE", "Tệp tải lên vượt quá giới hạn dung lượng.")
        validated = validate_image_bytes(data, settings.max_image_pixels)
        stored: ImageStorage = request.app.state.storage
        metadata = stored.store(data, file.filename, validated)
        return {
            "image_id": metadata.image_id,
            "filename": metadata.filename,
            "content_type": metadata.content_type,
            "size_bytes": metadata.size_bytes,
            "width": metadata.width,
            "height": metadata.height,
            "url": f"/api/images/{metadata.image_id}",
        }
    finally:
        await form.close()


@router.get(
    "/images/{image_id}",
    response_class=FileResponse,
    responses={
        200: {"content": {"image/jpeg": {}, "image/png": {}}},
        404: {"model": ErrorResponse, "description": "Ảnh không tồn tại hoặc đã hết hạn."},
        422: {"model": ErrorResponse, "description": "UUID ảnh không hợp lệ."},
    },
)
async def get_original(image_id: UUID4, request: Request) -> FileResponse:
    image_id_string = str(image_id)
    metadata = request.app.state.storage.get(image_id_string)
    if metadata is None:
        raise ApiError(404, "IMAGE_NOT_FOUND", "Không tìm thấy ảnh hoặc ảnh đã hết hạn.")
    return FileResponse(
        metadata.path,
        media_type=metadata.content_type,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post(
    "/process",
    response_model=ProcessResultResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Ảnh không tồn tại hoặc đã hết hạn."},
        422: {"model": ErrorResponse, "description": "Request hoặc các bước không hợp lệ."},
        501: {"model": ErrorResponse, "description": "Xử lý ảnh chưa được triển khai."},
        503: {"model": ErrorResponse, "description": "Thiếu mô hình hoặc máy chủ đang xử lý ảnh khác."},
    },
)
def process(payload: ProcessRequest, request: Request) -> dict[str, Any]:
    original = request.app.state.storage.get(str(payload.image_id))
    if original is None:
        raise ApiError(404, "IMAGE_NOT_FOUND", "Không tìm thấy ảnh hoặc ảnh đã hết hạn.")
    lock = request.app.state.processing_lock
    if not lock.acquire(blocking=False):
        raise ApiError(503, "PROCESSING_BUSY", "Máy chủ đang xử lý ảnh khác. Vui lòng thử lại sau.")
    try:
        return create_result(original, [step.model_dump() for step in payload.steps], request.app.state.settings, request.app.state.result_storage)
    finally:
        lock.release()


@router.post(
    "/advise",
    status_code=501,
    response_model=None,
    responses={
        404: {"model": ErrorResponse, "description": "Ảnh không tồn tại hoặc đã hết hạn."},
        422: {"model": ErrorResponse, "description": "Request hoặc các bước không hợp lệ."},
        501: {"model": ErrorResponse, "description": "AI tư vấn chưa được triển khai."},
    },
)
async def advise(payload: AdviseRequest, request: Request) -> None:
    _require_image(request, str(payload.image_id))
    raise ApiError(
        501,
        "NOT_IMPLEMENTED",
        "Chức năng AI tư vấn chưa được triển khai.",
    )


@router.get(
    "/download/{result_id}",
    response_class=FileResponse,
    responses={
        422: {"model": ErrorResponse, "description": "UUID kết quả không hợp lệ."},
        404: {"model": ErrorResponse, "description": "Kết quả không tồn tại hoặc đã hết hạn."},
    },
)
def download(result_id: UUID4, request: Request) -> FileResponse:
    result = _require_result(request, str(result_id))
    return FileResponse(result.path, media_type=result.content_type, filename=result.filename,
                        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@router.get("/results/{result_id}", response_class=FileResponse, responses={
    404: {"model": ErrorResponse, "description": "Kết quả không tồn tại hoặc đã hết hạn."},
    422: {"model": ErrorResponse, "description": "UUID không hợp lệ."},
})
def get_result(result_id: UUID4, request: Request) -> FileResponse:
    result = _require_result(request, str(result_id))
    return FileResponse(result.path, media_type=result.content_type,
                        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


def _require_result(request: Request, result_id: str):
    result = request.app.state.result_storage.get(result_id)
    if result is None or result.source_image_id is None:
        raise ApiError(404, "IMAGE_NOT_FOUND", "Không tìm thấy ảnh kết quả hoặc ảnh đã hết hạn.")
    return result


def _require_image(request: Request, image_id: str) -> None:
    metadata = request.app.state.storage.get(image_id)
    if metadata is None:
        raise ApiError(404, "IMAGE_NOT_FOUND", "Không tìm thấy ảnh hoặc ảnh đã hết hạn.")
