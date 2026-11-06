# Kiểm thử HTTP tương ứng api-client.ts: health/catalog/upload/original và các lỗi.
# Giữ payload/kiểu số/envelope nhất quán với FE; 501 là kỳ vọng của scaffold.

"""Contract and storage behavior tests."""

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.schemas.models import AdviseRequest, ProcessRequest
from tests.conftest import image_bytes


def upload(client: TestClient, data: bytes, filename: str = "family.jpg", mime: str = "image/jpeg"):
    return client.post("/api/upload", files={"file": (filename, data, mime)})


def error_code(response) -> str:
    return response.json()["error"]["code"]


def test_health_shape_and_catalog_exact_ids_and_metadata(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "app": "resim", "version": "0.1.0"}

    catalog = client.get("/api/algorithms")
    assert catalog.status_code == 200
    items = catalog.json()["items"]
    assert [item["id"] for item in items] == [
        "denoise_median",
        "denoise_bilateral",
        "adjust_gamma",
        "enhance_clahe",
        "sharpen_unsharp",
        "reduce_scratches",
        "remove_yellow_cast",
        "colorize_image",
        "upscale_image",
    ]
    assert len({item["tool_id"] for item in items}) == 8
    assert {item["implementation_status"] for item in items} == {"implemented"}
    parameters = {
        item["id"]: {parameter["key"]: parameter for parameter in item["params"]}
        for item in items
    }
    expected = {
        "denoise_median": {"kernel_size": (3, [3, 5, 7])},
        "denoise_bilateral": {
            "diameter": (5, [5, 7, 9]),
            "sigma_color": (50, (1, 150, 1)),
            "sigma_space": (50, (1, 150, 1)),
        },
        "adjust_gamma": {"gamma": (1, (0.1, 3, 0.05))},
        "enhance_clahe": {
            "clip_limit": (2, (0.1, 10, 0.1)),
            "tile_grid_size": (8, (2, 16, 1)),
        },
        "sharpen_unsharp": {
            "amount": (0.8, (0, 3, 0.05)),
            "sigma": (1, (0.1, 5, 0.1)),
        },
        "reduce_scratches": {
            "sensitivity": (0.5, (0, 1, 0.05)),
            "inpaint_radius": (3, (1, 10, 1)),
        },
        "remove_yellow_cast": {"strength": (0.5, (0, 1, 0.05))},
        "colorize_image": {"strength": (1, (0, 1, 0.05))},
        "upscale_image": {"scale": (2, [2, 4])},
    }
    for algorithm_id, params in expected.items():
        assert set(parameters[algorithm_id]) == set(params)
        for key, (default, definition) in params.items():
            descriptor = parameters[algorithm_id][key]
            assert descriptor["default"] == default
            if isinstance(definition, list):
                assert [option["value"] for option in descriptor["options"]] == definition
                assert descriptor["min"] is descriptor["max"] is descriptor["step"] is None
                assert descriptor["kind"] == "select"
            else:
                assert (descriptor["min"], descriptor["max"], descriptor["step"]) == definition
                assert descriptor["options"] == []
                assert descriptor["kind"] == "number"


@pytest.mark.parametrize(
    ("image_format", "filename", "mime", "content_type"),
    [
        ("JPEG", "../../outside/portrait.jpg", "text/plain", "image/jpeg"),
        ("PNG", r"..\..\outside\portrait.png", "application/octet-stream", "image/png"),
    ],
)
def test_upload_and_read_preserve_exact_original_bytes(
    client, app, image_format, filename, mime, content_type
):
    original = image_bytes(image_format)
    response = upload(client, original, filename, mime)
    assert response.status_code == 201
    uploaded = response.json()
    assert UUID(uploaded["image_id"]).version == 4
    assert uploaded["filename"] == "portrait." + ("jpg" if image_format == "JPEG" else "png")
    assert uploaded["content_type"] == content_type
    assert uploaded["size_bytes"] == len(original)
    assert (uploaded["width"], uploaded["height"]) == (8, 6)
    assert uploaded["url"] == f"/api/images/{uploaded['image_id']}"

    downloaded = client.get(uploaded["url"])
    assert downloaded.status_code == 200
    assert downloaded.headers["content-type"] == content_type
    assert downloaded.headers["x-content-type-options"] == "nosniff"
    assert downloaded.headers["cache-control"] == "private, no-store"
    assert downloaded.content == original

    files = list(app.state.storage.root.iterdir())
    assert len(files) == 2
    assert {path.suffix for path in files} == ({".json", ".jpg"} if image_format == "JPEG" else {".json", ".png"})


@pytest.mark.parametrize(
    "data",
    [b"", b"not an image", b"\x89PNG\r\n\x1a\ntruncated", image_bytes("GIF")],
)
def test_empty_fake_and_corrupt_uploads_are_rejected_without_orphans(client, app, data):
    response = upload(client, data)
    assert response.status_code == 415
    assert error_code(response) == "UNSUPPORTED_IMAGE"
    assert response.json()["error"]["details"] is None
    assert list(app.state.storage.root.iterdir()) == []


def test_jpeg_missing_end_marker_is_rejected_without_storing_file(client, app):
    original = image_bytes("JPEG")
    assert original.endswith(b"\xff\xd9")

    response = upload(client, original[:-2])

    assert response.status_code == 415
    assert error_code(response) == "UNSUPPORTED_IMAGE"
    assert list(app.state.storage.root.iterdir()) == []


def test_upload_requires_exactly_one_file_field(client):
    valid = image_bytes()
    response = client.post(
        "/api/upload",
        files=[("file", ("one.jpg", valid, "image/jpeg")), ("extra", ("two.jpg", valid, "image/jpeg"))],
    )
    assert response.status_code == 422
    assert error_code(response) == "VALIDATION_ERROR"

    response = client.post("/api/upload", data={"file": "not a file"})
    assert response.status_code == 422
    assert error_code(response) == "VALIDATION_ERROR"


def test_malformed_multipart_has_standard_validation_error(client):
    response = client.post(
        "/api/upload",
        content=b"--boundary\r\nnot a valid part",
        headers={"Content-Type": "multipart/form-data; boundary=boundary"},
    )
    assert response.status_code == 422
    assert error_code(response) == "VALIDATION_ERROR"


def test_byte_limit_is_enforced_without_storing_file(tmp_path):
    original = image_bytes("PNG")
    limit = len(original) + 4
    configured = Settings(storage_dir=tmp_path / "storage", max_upload_bytes=limit)
    app = create_app(configured)
    with TestClient(app) as client:
        response = upload(client, original + b"extra")
        assert response.status_code == 413
        assert error_code(response) == "FILE_TOO_LARGE"
        assert list(app.state.storage.root.iterdir()) == []


def test_multipart_body_is_bounded_before_form_spooling(tmp_path):
    app = create_app(Settings(storage_dir=tmp_path / "storage", max_upload_bytes=100))
    with TestClient(app) as client:
        response = upload(client, b"x" * (100 + 64 * 1024 + 1))
        assert response.status_code == 413
        assert error_code(response) == "FILE_TOO_LARGE"
        assert list(app.state.storage.root.iterdir()) == []


@pytest.mark.parametrize("file_size", [101, 70_000])
def test_oversized_upload_errors_keep_cors_headers(tmp_path, file_size):
    app = create_app(Settings(storage_dir=tmp_path / "storage", max_upload_bytes=100))
    with TestClient(app) as client:
        response = client.post(
            "/api/upload",
            files={"file": ("large.png", b"x" * file_size, "image/png")},
            headers={"Origin": "http://localhost:3000"},
        )
        assert response.status_code == 413
        assert error_code(response) == "FILE_TOO_LARGE"
        assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
        assert list(app.state.storage.root.iterdir()) == []


def test_pixel_limit_is_enforced_before_storage(tmp_path):
    app = create_app(Settings(storage_dir=tmp_path / "storage", max_image_pixels=20))
    with TestClient(app) as client:
        response = upload(client, image_bytes("PNG", (5, 5)), "small.png", "image/png")
        assert response.status_code == 422
        assert error_code(response) == "IMAGE_TOO_LARGE"
        assert list(app.state.storage.root.iterdir()) == []


def test_invalid_and_missing_image_ids_have_distinct_errors(client):
    malformed = client.get("/api/images/not-a-uuid")
    assert malformed.status_code == 422
    assert error_code(malformed) == "VALIDATION_ERROR"
    assert malformed.json()["error"]["details"]

    valid_but_missing = str(uuid4())
    missing = client.get(f"/api/images/{valid_but_missing}")
    assert missing.status_code == 404
    assert error_code(missing) == "IMAGE_NOT_FOUND"

    version_one = "f47ac10b-58cc-11cf-a447-001122334455"
    response = client.get(f"/api/images/{version_one}")
    assert response.status_code == 422
    assert error_code(response) == "VALIDATION_ERROR"


def test_expired_original_is_404_and_cleaned(client, app):
    uploaded = upload(client, image_bytes()).json()
    manifest_path = app.state.storage.root / f"{uploaded['image_id']}.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["created_at"] = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    response = client.get(uploaded["url"])
    assert response.status_code == 404
    assert error_code(response) == "IMAGE_NOT_FOUND"
    assert not manifest_path.exists()
    assert not (app.state.storage.root / f"{uploaded['image_id']}.jpg").exists()


def test_process_existing_tools_returns_result_and_preserves_original(client, app):
    original = image_bytes()
    uploaded = upload(client, original).json()
    before = {path.name for path in app.state.storage.root.iterdir()}
    response = client.post(
        "/api/process",
        json={
            "image_id": uploaded["image_id"],
            "steps": [
                {"algorithm": "denoise_median", "params": {}},
                {"algorithm": "adjust_gamma", "params": {"gamma": 1.23}},
            ],
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert (result["width"], result["height"]) == (8, 6)
    assert client.get(result["url"]).status_code == 200
    assert client.get(uploaded["url"]).content == original
    assert {path.name for path in app.state.storage.root.iterdir() if path.is_file()} == before


@pytest.mark.parametrize(
    "steps",
    [
        [],
        [{"algorithm": "unknown", "params": {}}],
        [{"algorithm": "adjust_gamma", "params": {"gamma": 0}}],
        [{"algorithm": "adjust_gamma", "params": {"gamma": "1.2"}}],
        [{"algorithm": "adjust_gamma", "params": {"gamma": True}}],
        [{"algorithm": "adjust_gamma", "params": {"gamma": 10**400}}],
        [{"algorithm": "adjust_gamma", "params": {"gamma": 1, "other": 2}}],
        [{"algorithm": "denoise_median", "params": {"kernel_size": 4}}],
        [
            {"algorithm": "denoise_median", "params": {}},
            {"algorithm": "denoise_bilateral", "params": {}},
        ],
        [
            {"algorithm": "adjust_gamma", "params": {}},
            {"algorithm": "adjust_gamma", "params": {}},
        ],
        [
            {"algorithm": "upscale_image", "params": {}},
            {"algorithm": "adjust_gamma", "params": {}},
        ],
        [{"algorithm": "denoise_median", "params": {"kernel_size": 3.0}}],
    ],
)
def test_process_rejects_invalid_steps(client, steps):
    response = client.post(
        "/api/process",
        json={"image_id": str(uuid4()), "steps": steps},
    )
    assert response.status_code == 422
    assert error_code(response) == "VALIDATION_ERROR"
    assert isinstance(response.json()["error"]["details"], list)


def test_process_unknown_top_level_fields_and_missing_image_are_rejected(client):
    response = client.post(
        "/api/process",
        json={"image_id": str(uuid4()), "steps": [{"algorithm": "adjust_gamma", "params": {}}], "extra": True},
    )
    assert response.status_code == 422
    assert error_code(response) == "VALIDATION_ERROR"

    response = client.post(
        "/api/process",
        json={"image_id": str(uuid4()), "steps": [{"algorithm": "adjust_gamma", "params": {}}]},
    )
    assert response.status_code == 404
    assert error_code(response) == "IMAGE_NOT_FOUND"


def test_step_schema_fills_defaults_trims_prompt_and_preserves_order():
    steps = ProcessRequest.model_validate(
        {
            "image_id": str(uuid4()),
            "steps": [
                {"algorithm": "adjust_gamma", "params": {"gamma": 1.23}},
                {"algorithm": "upscale_image", "params": {}},
            ],
        }
    ).steps
    assert [step.algorithm for step in steps] == ["adjust_gamma", "upscale_image"]
    assert steps[0].params == {"gamma": 1.23}
    assert steps[1].params == {"scale": 2}

    advise = AdviseRequest.model_validate(
        {"image_id": str(uuid4()), "prompt": "  keep it natural  ", "steps": []}
    )
    assert advise.prompt == "keep it natural"


def test_advise_validation_image_existence_and_501(client):
    valid = upload(client, image_bytes()).json()
    request = {
        "image_id": valid["image_id"],
        "prompt": "  Ảnh hơi tối, giữ vẻ tự nhiên.  ",
        "steps": [{"algorithm": "adjust_gamma", "params": {"gamma": 1.2}}],
        "current_result_id": None,
    }
    response = client.post("/api/advise", json=request)
    assert response.status_code == 501
    assert response.json()["error"]["code"] == "NOT_IMPLEMENTED"
    assert response.json()["error"]["message"] == "Chức năng AI tư vấn chưa được triển khai."

    for prompt in ("  \t", "x" * 2001):
        invalid = client.post("/api/advise", json={**request, "prompt": prompt})
        assert invalid.status_code == 422
        assert error_code(invalid) == "VALIDATION_ERROR"

    invalid_steps = client.post("/api/advise", json={**request, "steps": [{"algorithm": "unknown", "params": {}}]})
    assert invalid_steps.status_code == 422
    assert error_code(invalid_steps) == "VALIDATION_ERROR"

    missing_steps = client.post("/api/advise", json={"image_id": valid["image_id"], "prompt": "please"})
    assert missing_steps.status_code == 422
    assert error_code(missing_steps) == "VALIDATION_ERROR"

    invalid_result_id = client.post("/api/advise", json={**request, "current_result_id": "not-a-uuid"})
    assert invalid_result_id.status_code == 422
    assert error_code(invalid_result_id) == "VALIDATION_ERROR"

    missing_image = client.post("/api/advise", json={**request, "image_id": str(uuid4())})
    assert missing_image.status_code == 404
    assert error_code(missing_image) == "IMAGE_NOT_FOUND"


def test_download_uuid_validation_and_missing_result(client):
    response = client.get(f"/api/download/{uuid4()}")
    assert response.status_code == 404
    assert response.json()["error"] == {
        "code": "IMAGE_NOT_FOUND",
        "message": "Không tìm thấy ảnh kết quả hoặc ảnh đã hết hạn.",
        "details": None,
    }

    invalid = client.get("/api/download/not-a-uuid")
    assert invalid.status_code == 422
    assert error_code(invalid) == "VALIDATION_ERROR"


def test_cors_preflight_allows_only_configured_origins(client):
    for origin in ("http://localhost:3000", "http://127.0.0.1:3000"):
        response = client.options(
            "/api/process",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin
        assert "POST" in response.headers["access-control-allow-methods"]

    response = client.options(
        "/api/process",
        headers={
            "Origin": "https://not-allowed.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_openapi_exposes_501_contract_and_validation_responses(client):
    schema = client.get("/openapi.json").json()
    upload_body = schema["paths"]["/api/upload"]["post"]["requestBody"]
    assert upload_body["required"] is True
    upload_schema = upload_body["content"]["multipart/form-data"]["schema"]
    assert upload_schema["required"] == ["file"]
    assert upload_schema["properties"]["file"] == {"type": "string", "format": "binary"}
    assert upload_schema["additionalProperties"] is False
    process_responses = schema["paths"]["/api/process"]["post"]["responses"]
    assert "501" in process_responses
    assert "404" in process_responses
    advise_responses = schema["paths"]["/api/advise"]["post"]["responses"]
    assert "501" in advise_responses
    download_responses = schema["paths"]["/api/download/{result_id}"]["get"]["responses"]
    assert "200" in download_responses
    assert "404" in download_responses
    assert "422" in download_responses


def test_relative_storage_path_is_project_based_not_cwd(tmp_path):
    settings = Settings(storage_dir=Path("relative-storage"))
    assert settings.storage_dir.is_absolute()
    assert settings.storage_dir.name == "relative-storage"
