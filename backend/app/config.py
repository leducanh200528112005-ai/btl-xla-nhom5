# Đọc backend/.env với tiền tố RESIM_; xem .env.example cho cấu hình mặc định.
# NEXT_PUBLIC_API_BASE_URL thuộc frontend, phải trỏ tới địa chỉ FastAPI đang chạy.
# cors_origins là origin của trang frontend, không phải URL backend.
# Giới hạn byte/pixel ở đây là kiểm tra cuối cùng dù frontend đã kiểm tra file.

"""Runtime settings for the Resim API."""

from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    """Environment-backed settings with paths independent of the process cwd."""

    model_config = SettingsConfigDict(
        env_prefix="RESIM_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    storage_dir: Path = Field(default_factory=lambda: _BACKEND_DIR / ".storage")
    max_upload_bytes: int = Field(default=10 * 1024 * 1024, gt=0)
    max_image_pixels: int = Field(default=20_000_000, gt=0)
    max_result_pixels: int = Field(default=32_000_000, gt=0)
    colorization_model_dir: Path = Field(default_factory=lambda: _BACKEND_DIR / "models" / "colorization")
    image_ttl_hours: int = Field(default=24, gt=0)
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    )

    @field_validator("storage_dir", "colorization_model_dir", mode="before")
    @classmethod
    def resolve_storage_path(cls, value: str | Path) -> Path:
        path = Path(value).expanduser()
        if not path.is_absolute():
            path = _BACKEND_DIR / path
        return path.resolve()

    @field_validator("cors_origins")
    @classmethod
    def validate_cors_origins(cls, origins: list[str]) -> list[str]:
        cleaned = [origin.strip().rstrip("/") for origin in origins if origin.strip()]
        if "*" in cleaned:
            raise ValueError("Wildcard CORS origins are not supported.")
        return cleaned
