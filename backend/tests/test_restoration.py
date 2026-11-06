"""Quality properties of sharpening/scratch removal and complete pipeline."""
from io import BytesIO

import cv2
import numpy as np
import pytest
from PIL import Image

from app.algorithms.sharpen import sharpen_unsharp
from app.algorithms.scratches import detect_scratches, reduce_scratches
from app.algorithms.denoise import denoise_median, denoise_bilateral
from app.algorithms.brightness import adjust_gamma
from app.algorithms.contrast import enhance_clahe
from app.pipeline import IMPLEMENTED_ALGORITHMS
from app.algorithms.colorize import MODEL_FILES
from app.config import Settings


def test_unsharp_increases_edge_contrast_without_wraparound_or_mutation():
    image = np.full((64, 64, 3), 90, np.uint8)
    image[:, 32:] = 160
    original = image.copy()
    output = sharpen_unsharp(image, {"amount": 1, "sigma": 1})
    assert output[30, 31, 0] < 90
    assert output[30, 32, 0] > 160
    assert output.dtype == np.uint8
    np.testing.assert_array_equal(image, original)
    np.testing.assert_array_equal(sharpen_unsharp(image, {"amount": 0}), image)
    extreme = np.zeros_like(image)
    extreme[:, 32:] = 255
    np.testing.assert_array_equal(sharpen_unsharp(extreme, {"amount": 3}), extreme)


@pytest.mark.parametrize("color", [0, 255])
@pytest.mark.parametrize("direction", ["horizontal", "vertical", "diagonal"])
def test_scratches_restore_synthetic_lines_and_preserve_unmasked_pixels(color, direction):
    clean = np.full((96, 96, 3), 120, np.uint8)
    image = clean.copy()
    end = {"horizontal": (80, 15), "vertical": (15, 80), "diagonal": (80, 80)}[direction]
    cv2.line(image, (15, 15), end, (color, color, color), 2)
    original = image.copy()
    params = {"sensitivity": 0.5, "inpaint_radius": 3}
    mask = detect_scratches(image, params)
    result = reduce_scratches(image, params)
    damaged = np.any(image != clean, axis=2)
    assert np.count_nonzero(mask[damaged]) / damaged.sum() > 0.8
    assert np.abs(result.astype(float) - clean).mean() < np.abs(image.astype(float) - clean).mean() * 0.2
    np.testing.assert_array_equal(result[mask == 0], image[mask == 0])
    np.testing.assert_array_equal(image, original)


def test_scratches_ignore_flat_image_broad_edge_and_zero_sensitivity():
    image = np.full((64, 64, 3), 80, np.uint8)
    image[:, 32:] = 190
    assert not np.any(detect_scratches(image, {}))
    np.testing.assert_array_equal(reduce_scratches(image, {}), image)
    cv2.line(image, (10, 10), (10, 50), (255, 255, 255), 2)
    assert not np.any(detect_scratches(image, {"sensitivity": 0}))
    np.testing.assert_array_equal(reduce_scratches(image, {"sensitivity": 0}), image)


def test_scratch_sensitivity_lowers_contrast_threshold():
    image = np.full((64, 64, 3), 120, np.uint8)
    cv2.line(image, (15, 10), (15, 50), (150, 150, 150), 2)
    assert not np.any(detect_scratches(image, {"sensitivity": 0.1}))
    assert np.any(detect_scratches(image, {"sensitivity": 1}))


@pytest.mark.parametrize("function", [denoise_median, denoise_bilateral, adjust_gamma, enhance_clahe, sharpen_unsharp, reduce_scratches])
@pytest.mark.parametrize("invalid", [None, np.zeros((0, 3, 3), np.uint8), np.zeros((5, 5), np.uint8), np.zeros((5, 5, 3), float)])
def test_algorithms_reject_invalid_image_arrays(function, invalid):
    with pytest.raises(ValueError):
        function(invalid, {})


@pytest.mark.parametrize("shape", [(1, 1, 3), (1, 5, 3), (2, 3, 3)])
def test_new_algorithms_handle_tiny_images(shape):
    image = np.full(shape, 100, np.uint8)
    for function in (sharpen_unsharp, reduce_scratches):
        output = function(image, {})
        np.testing.assert_array_equal(output, image)
        assert not np.shares_memory(output, image)


@pytest.mark.parametrize("function,params", [(sharpen_unsharp, {"amount": 4}), (sharpen_unsharp, {"sigma": True}), (reduce_scratches, {"sensitivity": -1}), (reduce_scratches, {"inpaint_radius": 1.5})])
def test_new_algorithms_validate_parameters(function, params):
    with pytest.raises(ValueError):
        function(np.zeros((16, 16, 3), np.uint8), params)


@pytest.mark.parametrize("denoise", ["denoise_median", "denoise_bilateral"])
def test_all_eight_tools_via_http(client, denoise):
    if not all((Settings().colorization_model_dir / name).is_file() for name in MODEL_FILES):
        pytest.skip("Install weights with scripts/download_colorization.py for all-eight real inference")
    image = np.full((48, 64, 3), (80, 100, 120), np.uint8)
    cv2.line(image, (12, 8), (12, 40), (255, 255, 255), 2)
    data = BytesIO()
    Image.fromarray(image).save(data, format="PNG")
    asset = client.post("/api/upload", files={"file": ("photo.png", data.getvalue(), "image/png")}).json()
    names = ["reduce_scratches", denoise, "remove_yellow_cast", "adjust_gamma", "enhance_clahe", "colorize_image", "sharpen_unsharp", "upscale_image"]
    assert set(IMPLEMENTED_ALGORITHMS) == set(names) | {"denoise_median", "denoise_bilateral"}
    response = client.post("/api/process", json={"image_id": asset["image_id"], "steps": [{"algorithm": name, "params": {}} for name in names]})
    assert response.status_code == 200, response.text
    result = response.json()
    assert (result["width"], result["height"]) == (128, 96)
    preview = client.get(result["url"])
    assert client.get(f"/api/download/{result['result_id']}").content == preview.content
    with Image.open(BytesIO(preview.content)) as output:
        assert output.size == (128, 96)
    assert client.get(asset["url"]).content == data.getvalue()
