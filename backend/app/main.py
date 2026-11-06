# Điểm khởi động FastAPI, chạy bằng backend/run.cmd.
# Editor.tsx gọi /api/health và /api/algorithms khi kết nối backend.
# CORS phải cho phép origin frontend; lỗi cũng dùng envelope mà api-client.ts đọc được.

"""FastAPI application factory and error/CORS wiring."""

from contextlib import asynccontextmanager
import logging
from threading import Lock
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import Settings
from app.errors import (
    ApiError,
    api_error_handler,
    error_body,
    http_error_handler,
    validation_error_handler,
)
from app.middleware import UploadBodyLimitMiddleware
from app.services.image_storage import ImageStorage

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create the API with injectable settings and isolated storage for tests."""

    configured = settings or Settings()
    storage = ImageStorage(configured)
    result_storage = ImageStorage(configured.model_copy(update={"storage_dir": configured.storage_dir / "results"}))

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        storage.cleanup_expired()
        if result_storage.root.exists():
            result_storage.cleanup_expired()
        yield

    app = FastAPI(
        title="Resim API",
        version="0.1.0",
        description="Upload, xử lý và lưu kết quả ảnh Resim; AI tư vấn chưa triển khai.",
        lifespan=lifespan,
    )
    app.state.settings = configured
    app.state.storage = storage
    app.state.result_storage = result_storage
    app.state.processing_lock = Lock()
    app.include_router(router)
    app.add_middleware(
        UploadBodyLimitMiddleware,
        max_upload_bytes=configured.max_upload_bytes,
    )
    # Last-added middleware runs first, so CORS also covers early upload rejections.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=configured.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
        max_age=600,
    )
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_error_handler)

    @app.exception_handler(Exception)
    async def unexpected_error_handler(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unexpected API error", exc_info=exc)
        return JSONResponse(
            status_code=500,
            content=error_body(
                "INTERNAL_ERROR",
                "Đã xảy ra lỗi nội bộ. Vui lòng thử lại sau.",
            ),
        )

    return app


app = create_app()
