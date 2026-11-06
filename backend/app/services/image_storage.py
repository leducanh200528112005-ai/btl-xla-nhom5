# Phục vụ vùng upload/canvas: kiểm tra JPEG/PNG thật, lưu nguyên bytes và metadata.
# UploadResponse cung cấp image_id, filename, content_type, size_bytes, width, height, url.
# Canvas có thể xem preview local trước khi upload xong; preview không phải ID server.
# UUID và TTL quyết định ảnh còn tồn tại cho process/advise; hết hạn trả 404.
# Kho ảnh gốc và kho kết quả dùng instance/root riêng; kết quả có source_image_id.

"""Bounded JPEG/PNG validation and original-byte storage."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from io import BytesIO
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Literal
from uuid import uuid4
import warnings

from PIL import Image, UnidentifiedImageError

from app.config import Settings
from app.errors import ApiError

ImageFormat = Literal["JPEG", "PNG"]
_UUID4_FILENAME = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
_FORMAT_DETAILS: dict[str, tuple[str, str]] = {
    "JPEG": ("image/jpeg", ".jpg"),
    "PNG": ("image/png", ".png"),
}


@dataclass(frozen=True)
class ValidatedImage:
    """Verified metadata read from the original file without re-encoding it."""

    image_format: ImageFormat
    content_type: Literal["image/jpeg", "image/png"]
    extension: Literal[".jpg", ".png"]
    width: int
    height: int


@dataclass(frozen=True)
class StoredImage:
    """Metadata for one stored original and its server-generated path."""

    image_id: str
    filename: str
    content_type: Literal["image/jpeg", "image/png"]
    size_bytes: int
    width: int
    height: int
    path: Path
    created_at: datetime
    source_image_id: str | None = None


def validate_image_bytes(data: bytes, max_image_pixels: int) -> ValidatedImage:
    """Verify JPEG/PNG content and dimensions while preserving the supplied bytes."""

    if not data:
        raise ApiError(415, "UNSUPPORTED_IMAGE", "Tệp tải lên không phải ảnh JPEG hoặc PNG hợp lệ.")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                image_format = image.format
                if image_format not in _FORMAT_DETAILS:
                    raise ApiError(
                        415,
                        "UNSUPPORTED_IMAGE",
                        "Chỉ hỗ trợ ảnh JPEG hoặc PNG hợp lệ.",
                    )
                width, height = image.size
                if width <= 0 or height <= 0 or width * height > max_image_pixels:
                    raise ApiError(
                        422,
                        "IMAGE_TOO_LARGE",
                        "Kích thước ảnh vượt giới hạn cho phép.",
                    )
                image.verify()
            # verify() checks structure but does not decode all pixel data (for
            # example, it may accept a JPEG missing its EOI marker). Reopen and
            # fully decode only after enforcing the configured pixel bound.
            with Image.open(BytesIO(data)) as decoded_image:
                if decoded_image.format != image_format or decoded_image.size != (width, height):
                    raise UnidentifiedImageError("Image metadata changed during validation.")
                decoded_image.load()
    except ApiError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ApiError(
            422,
            "IMAGE_TOO_LARGE",
            "Kích thước ảnh vượt giới hạn cho phép.",
        ) from None
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError):
        raise ApiError(
            415,
            "UNSUPPORTED_IMAGE",
            "Tệp tải lên không phải ảnh JPEG hoặc PNG hợp lệ.",
        ) from None

    content_type, extension = _FORMAT_DETAILS[image_format]
    return ValidatedImage(
        image_format=image_format,  # type: ignore[arg-type]
        content_type=content_type,  # type: ignore[arg-type]
        extension=extension,  # type: ignore[arg-type]
        width=width,
        height=height,
    )


def safe_display_filename(filename: str | None) -> str:
    """Keep only a display basename; this value is never used as a storage path."""

    value = (filename or "image").replace("\\", "/").rsplit("/", 1)[-1]
    value = "".join("_" if ord(character) < 32 or ord(character) == 127 else character for character in value)
    value = value.strip().strip(".")[:255]
    return value or "image"


class ImageStorage:
    """Store originals under generated UUID names and enforce a simple asset TTL."""

    def __init__(self, settings: Settings) -> None:
        self.root = settings.storage_dir
        self.ttl = timedelta(hours=settings.image_ttl_hours)

    def ensure_root(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)

    def store(
        self,
        data: bytes,
        filename: str | None,
        validated: ValidatedImage,
        *,
        source_image_id: str | None = None,
    ) -> StoredImage:
        """Atomically persist the original bytes and a minimal JSON sidecar."""

        self.ensure_root()
        self._cleanup_stale_assets()
        image_id = str(uuid4())
        image_path = self.root / f"{image_id}{validated.extension}"
        manifest_path = self.root / f"{image_id}.json"
        now = datetime.now(timezone.utc)
        display_name = safe_display_filename(filename)
        manifest = {
            "image_id": image_id,
            "filename": display_name,
            "content_type": validated.content_type,
            "size_bytes": len(data),
            "width": validated.width,
            "height": validated.height,
            "created_at": now.isoformat(),
            "extension": validated.extension,
        }
        if source_image_id is not None:
            manifest["source_image_id"] = source_image_id

        image_temp: Path | None = None
        metadata_temp: Path | None = None
        image_committed = False
        metadata_committed = False
        try:
            image_temp = self._write_temp(data)
            metadata_temp = self._write_temp(
                json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            )
            os.replace(image_temp, image_path)
            image_committed = True
            os.replace(metadata_temp, manifest_path)
            metadata_committed = True
        except OSError:
            if image_committed:
                image_path.unlink(missing_ok=True)
            if metadata_committed:
                manifest_path.unlink(missing_ok=True)
            raise
        finally:
            if image_temp is not None:
                image_temp.unlink(missing_ok=True)
            if metadata_temp is not None:
                metadata_temp.unlink(missing_ok=True)

        return StoredImage(
            image_id=image_id,
            filename=display_name,
            content_type=validated.content_type,
            size_bytes=len(data),
            width=validated.width,
            height=validated.height,
            path=image_path,
            created_at=now,
            source_image_id=source_image_id,
        )

    def get(self, image_id: str) -> StoredImage | None:
        """Return a non-expired original, deleting its owned files after TTL."""

        if not _UUID4_FILENAME.fullmatch(image_id):
            return None
        manifest_path = self.root / f"{image_id}.json"
        if manifest_path.is_symlink() or not manifest_path.is_file():
            return None
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            created_at = datetime.fromisoformat(manifest["created_at"])
            extension = manifest["extension"]
            content_type = manifest["content_type"]
            if created_at.tzinfo is None or extension not in {".jpg", ".png"}:
                return None
            expected_content_type = "image/jpeg" if extension == ".jpg" else "image/png"
            if content_type != expected_content_type or manifest["image_id"] != image_id:
                return None
            image_path = self.root / f"{image_id}{extension}"
            if image_path.is_symlink() or not image_path.is_file():
                return None
            if datetime.now(timezone.utc) - created_at >= self.ttl:
                self._delete_asset(image_id)
                return None
            return StoredImage(
                image_id=image_id,
                filename=str(manifest["filename"]),
                content_type=content_type,
                size_bytes=int(manifest["size_bytes"]),
                width=int(manifest["width"]),
                height=int(manifest["height"]),
                path=image_path,
                created_at=created_at,
                source_image_id=manifest.get("source_image_id"),
            )
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            return None

    def cleanup_expired(self) -> int:
        """Remove expired app-owned files directly inside the storage root."""

        self.ensure_root()
        return self._cleanup_stale_assets()

    def _cleanup_stale_assets(self) -> int:
        now = datetime.now(timezone.utc)
        removed = 0
        try:
            entries = list(self.root.iterdir())
        except OSError:
            return 0
        for entry in entries:
            if entry.name.startswith(".resim-") and entry.suffix == ".tmp":
                if not entry.is_symlink() and entry.is_file():
                    try:
                        modified_at = datetime.fromtimestamp(entry.stat().st_mtime, timezone.utc)
                        if now - modified_at >= self.ttl:
                            entry.unlink(missing_ok=True)
                    except OSError:
                        continue
                continue

            if entry.suffix in {".jpg", ".png"} and _UUID4_FILENAME.fullmatch(entry.stem):
                manifest_path = self.root / f"{entry.stem}.json"
                if (
                    not manifest_path.exists()
                    and not manifest_path.is_symlink()
                    and not entry.is_symlink()
                    and entry.is_file()
                ):
                    try:
                        modified_at = datetime.fromtimestamp(entry.stat().st_mtime, timezone.utc)
                        if now - modified_at >= self.ttl:
                            entry.unlink(missing_ok=True)
                    except OSError:
                        continue
                continue

            if entry.suffix != ".json" or not _UUID4_FILENAME.fullmatch(entry.stem):
                continue
            if entry.is_symlink() or not entry.is_file():
                continue
            image_id = entry.stem
            expired = False
            try:
                manifest = json.loads(entry.read_text(encoding="utf-8"))
                created_at = datetime.fromisoformat(manifest["created_at"])
                expired = created_at.tzinfo is None or now - created_at >= self.ttl
            except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
                expired = True
            if expired:
                removed += self._delete_asset(image_id)
        return removed

    def _delete_asset(self, image_id: str) -> int:
        removed = 0
        for extension in (".json", ".jpg", ".png"):
            path = self.root / f"{image_id}{extension}"
            try:
                if path.exists() or path.is_symlink():
                    path.unlink(missing_ok=True)
                    removed += 1
            except OSError:
                continue
        return removed

    def _write_temp(self, data: bytes) -> Path:
        descriptor, name = tempfile.mkstemp(prefix=".resim-", suffix=".tmp", dir=self.root)
        path = Path(name)
        try:
            with os.fdopen(descriptor, "wb") as temporary_file:
                temporary_file.write(data)
                temporary_file.flush()
                os.fsync(temporary_file.fileno())
        except OSError:
            path.unlink(missing_ok=True)
            raise
        return path
