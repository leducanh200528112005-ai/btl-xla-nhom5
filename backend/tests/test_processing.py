"""Algorithm properties and upload -> process -> preview/download integration."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from io import BytesIO
import json
from pathlib import Path
from uuid import uuid4

import cv2
import numpy as np
from PIL import Image
import pytest

from app.algorithms.colorize import colorize_image, MODEL_FILES
from app.algorithms.upscale import upscale_image
from app.algorithms.yellowing import remove_yellow_cast
from app.config import Settings
from app.errors import ApiError
from app.pipeline import process_image
from tests.conftest import image_bytes


def step(name, **params):
    return {"algorithm": name, "params": params}


def upload(client, data=None):
    return client.post("/api/upload", files={"file": ("photo.png", data or image_bytes("PNG"), "image/png")}).json()


def request_process(client, uploaded, steps):
    return client.post("/api/process", json={"image_id": uploaded["image_id"], "steps": steps})


def test_yellow_cast_strength_luminance_and_no_mutation():
    original = np.full((32, 40, 3), (100, 180, 195), np.uint8)
    snapshot = original.copy()
    full = remove_yellow_cast(original, {"strength": 1})
    half = remove_yellow_cast(original, {"strength": 0.5})
    zero = remove_yellow_cast(original, {"strength": 0})
    np.testing.assert_array_equal(original, snapshot)
    np.testing.assert_array_equal(zero, original)
    assert not np.shares_memory(zero, original)
    before_lab = cv2.cvtColor(original.astype(np.float32) / 255, cv2.COLOR_BGR2Lab)
    after_lab = cv2.cvtColor(full.astype(np.float32) / 255, cv2.COLOR_BGR2Lab)
    assert after_lab[:, :, 2].mean() < before_lab[:, :, 2].mean() * 0.3
    assert abs(after_lab[:, :, 0].mean() - before_lab[:, :, 0].mean()) < 1
    np.testing.assert_allclose(half.astype(float), (original.astype(float) + full) / 2, atol=1)


@pytest.mark.parametrize("color", [(0, 0, 0), (255, 255, 255), (90, 90, 90), (180, 100, 70)])
def test_yellowing_leaves_neutral_and_cool_images_unchanged(color):
    image = np.full((9, 7, 3), color, np.uint8)
    np.testing.assert_array_equal(remove_yellow_cast(image, {"strength": 1}), image)


@pytest.mark.parametrize("scale", [2, 4])
def test_upscale_dimensions_channels_and_input_unchanged(scale):
    image = np.zeros((9, 7, 3), np.uint8)
    image[:, :3, 2] = 220
    original = image.copy()
    result = upscale_image(image, {"scale": scale})
    assert result.shape == (9 * scale, 7 * scale, 3)
    assert result.dtype == np.uint8
    assert np.all(result[:, :, :2] == 0)
    assert 0 < result[:, :, 2].max() <= 255
    assert len(np.unique(result[:, :, 2])) > len(np.unique(image[:, :, 2]))
    np.testing.assert_array_equal(image, original)


@pytest.mark.parametrize("function,params", [
    (remove_yellow_cast, {"strength": -0.1}),
    (colorize_image, {"strength": True}),
    (upscale_image, {"scale": "2"}),
    (upscale_image, {"scale": 3}),
])
def test_algorithms_validate_direct_call_parameters(function, params):
    with pytest.raises(ValueError):
        function(np.zeros((5, 5, 3), np.uint8), params)


def test_colorize_zero_is_exact_and_needs_no_weights(tmp_path):
    image = np.arange(60, dtype=np.uint8).reshape(4, 5, 3)
    result = colorize_image(image, {"strength": 0}, model_dir=tmp_path)
    np.testing.assert_array_equal(result, image)
    assert not np.shares_memory(result, image)


def test_missing_and_corrupt_model_are_explicit_errors(tmp_path):
    image = np.full((8, 8, 3), 120, np.uint8)
    for corrupt in (False, True):
        if corrupt:
            for name in MODEL_FILES:
                (tmp_path / name).write_bytes(b"invalid")
        with pytest.raises(ApiError) as error:
            colorize_image(image, {"strength": 1}, model_dir=tmp_path)
        assert error.value.status_code == 503
        assert error.value.code == "MODEL_UNAVAILABLE"


def test_pipeline_rejects_unfinished_step_before_any_processing(monkeypatch):
    import app.pipeline as pipeline
    monkeypatch.delitem(pipeline.IMPLEMENTED_ALGORITHMS, "adjust_gamma")
    monkeypatch.setitem(pipeline.IMPLEMENTED_ALGORITHMS, "remove_yellow_cast", lambda *_: pytest.fail("Should preflight first"))
    with pytest.raises(ApiError) as error:
        process_image(np.full((4, 4, 3), 120, np.uint8), [step("remove_yellow_cast"), step("adjust_gamma")])
    assert error.value.status_code == 501


def test_pipeline_budget_rejected_before_upscale(monkeypatch):
    import app.pipeline as pipeline
    monkeypatch.setitem(pipeline.IMPLEMENTED_ALGORITHMS, "upscale_image", lambda *_: pytest.fail("Must reject before allocation"))
    with pytest.raises(ApiError) as error:
        process_image(np.zeros((10, 10, 3), np.uint8), [step("upscale_image", scale=4)], max_result_pixels=1000)
    assert error.value.code == "IMAGE_TOO_LARGE"


def test_pipeline_preserves_request_order_and_source(monkeypatch):
    import app.pipeline as pipeline
    calls = []
    def yellow(image, params):
        calls.append("yellow")
        image[:] = 25
        return image
    def color(image, params, **kwargs):
        calls.append("color")
        assert np.all(image == 25)
        return image + 3
    monkeypatch.setitem(pipeline.IMPLEMENTED_ALGORITHMS, "remove_yellow_cast", yellow)
    monkeypatch.setitem(pipeline.IMPLEMENTED_ALGORITHMS, "colorize_image", color)
    original = np.zeros((4, 5, 3), np.uint8)
    result = process_image(original, [step("remove_yellow_cast"), step("colorize_image")])
    assert calls == ["yellow", "color"]
    assert np.all(result == 28)
    assert np.all(original == 0)


@pytest.mark.parametrize("scale", [2, 4])
def test_upload_process_preview_download_roundtrip(client, app, scale):
    data = image_bytes("PNG")
    asset = upload(client, data)
    response = request_process(client, asset, [step("remove_yellow_cast", strength=0.6), step("upscale_image", scale=scale)])
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["image_id"] == asset["image_id"]
    assert result["result_id"] != asset["image_id"]
    assert (result["width"], result["height"]) == (8 * scale, 6 * scale)
    preview = client.get(result["url"])
    downloaded = client.get(f'/api/download/{result["result_id"]}')
    assert preview.status_code == downloaded.status_code == 200
    assert preview.content == downloaded.content
    assert len(preview.content) == result["size_bytes"]
    assert preview.headers["content-type"] == "image/png"
    assert "attachment" in downloaded.headers["content-disposition"]
    with Image.open(BytesIO(preview.content)) as image:
        assert image.size == (8 * scale, 6 * scale)
    assert client.get(asset["url"]).content == data
    assert client.get(f'/api/download/{asset["image_id"]}').status_code == 404
    assert client.get(f'/api/images/{result["result_id"]}').status_code == 404
    assert app.state.result_storage.get(result["result_id"]).source_image_id == asset["image_id"]


def test_result_expiry_and_unknown_ids(client, app):
    asset = upload(client)
    result = request_process(client, asset, [step("upscale_image")]).json()
    manifest_path = app.state.result_storage.root / f'{result["result_id"]}.json'
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["created_at"] = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    assert client.get(result["url"]).status_code == 404
    assert client.get(f'/api/download/{result["result_id"]}').status_code == 404
    assert not manifest_path.exists()
    assert client.get(asset["url"]).status_code == 200
    assert client.get(f"/api/results/{uuid4()}").status_code == 404
    assert client.get("/api/results/invalid").status_code == 422


def test_failed_model_and_budget_do_not_create_results(client, app, tmp_path):
    app.state.settings.colorization_model_dir = tmp_path / "missing"
    asset = upload(client)
    response = request_process(client, asset, [step("colorize_image")])
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "MODEL_UNAVAILABLE"
    app.state.settings.max_result_pixels = 100
    response = request_process(client, asset, [step("upscale_image", scale=4)])
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "IMAGE_TOO_LARGE"
    assert not app.state.result_storage.root.exists() or list(app.state.result_storage.root.iterdir()) == []


def test_concurrent_processing_is_bounded(client, app):
    asset = upload(client)
    with app.state.processing_lock:
        response = request_process(client, asset, [step("upscale_image")])
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "PROCESSING_BUSY"
    assert request_process(client, asset, [step("upscale_image")]).status_code == 200


def test_rgba_transparency_and_exif_orientation(client):
    source = Image.new("RGBA", (8, 6), (170, 150, 80, 90))
    data = BytesIO()
    source.save(data, format="PNG")
    asset = upload(client, data.getvalue())
    result = request_process(client, asset, [step("upscale_image", scale=2)]).json()
    with Image.open(BytesIO(client.get(result["url"]).content)) as image:
        assert image.mode == "RGBA"
        assert image.getchannel("A").getextrema() == (90, 90)

    source = Image.new("RGB", (8, 6), (170, 150, 80))
    exif = Image.Exif()
    exif[274] = 6
    data = BytesIO()
    source.save(data, format="JPEG", exif=exif)
    original = data.getvalue()
    asset = upload(client, original)
    result = request_process(client, asset, [step("upscale_image", scale=2)]).json()
    assert (result["width"], result["height"]) == (12, 16)
    assert client.get(asset["url"]).content == original


def test_real_colorization_model_and_full_pipeline(client):
    model_dir = Settings().colorization_model_dir
    if not all((model_dir / name).is_file() for name in MODEL_FILES):
        pytest.skip("Install weights with scripts/download_colorization.py for real inference")
    # Nonuniform grayscale input exercises actual network inference, not a mock.
    gray = np.tile(np.linspace(20, 230, 64, dtype=np.uint8), (48, 1))
    original = np.repeat(gray[:, :, None], 3, axis=2)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: colorize_image(original, {"strength": 1}), range(2)))
    np.testing.assert_array_equal(results[0], results[1])
    assert results[0].shape == original.shape
    assert np.abs(results[0][:, :, 0].astype(float) - results[0][:, :, 2]).mean() > 1
    data = BytesIO()
    Image.fromarray(original).save(data, format="PNG")
    asset = upload(client, data.getvalue())
    response = request_process(client, asset, [
        step("remove_yellow_cast", strength=0.5), step("colorize_image", strength=0.8), step("upscale_image", scale=4),
    ])
    assert response.status_code == 200, response.text
    result = response.json()
    assert (result["width"], result["height"]) == (256, 192)
    assert client.get(result["url"]).content != data.getvalue()
