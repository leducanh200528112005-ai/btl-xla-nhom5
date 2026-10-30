import cv2
import numpy as np
import pytest

from app.algorithms.contrast import enhance_clahe


CLAHE_CASES = [
    {"clip_limit": 0.1, "tile_grid_size": 2},
    {"clip_limit": 2.0, "tile_grid_size": 8},
    {"clip_limit": 10.0, "tile_grid_size": 16},
]


@pytest.mark.parametrize("params", CLAHE_CASES)
def test_output_contract_and_inputs_unchanged(params):
    rng = np.random.default_rng(42)
    image = rng.integers(
        0, 256, size=(32, 48, 3), dtype=np.uint8
    )
    before = image.copy()
    params_before = params.copy()

    result = enhance_clahe(image, params)

    assert result.shape == image.shape
    assert result.dtype == np.uint8
    assert not np.shares_memory(result, image)

    np.testing.assert_array_equal(image, before)
    assert params == params_before


@pytest.mark.parametrize("params", CLAHE_CASES)
@pytest.mark.parametrize(
    "shape",
    [
        (1, 1, 3),
        (1, 5, 3),
        (5, 1, 3),
        (2, 3, 3),
    ],
)
def test_small_images(params, shape):
    image = np.full(shape, (80, 100, 120), dtype=np.uint8)

    result = enhance_clahe(image, params)

    assert result.shape == shape
    assert result.dtype == np.uint8
    assert not np.shares_memory(result, image)


@pytest.mark.parametrize(
    "color",
    [
        (0, 0, 0),
        (255, 255, 255),
        (100, 100, 100),
        (80, 100, 120),
    ],
)
def test_uniform_image_has_no_artificial_spatial_texture(color):
    image = np.full((64, 64, 3), color, dtype=np.uint8)

    result = enhance_clahe(
        image,
        {"clip_limit": 2.0, "tile_grid_size": 8},
    )

    assert result.shape == image.shape
    assert result.dtype == np.uint8

    # CLAHE có thể thay đổi mức sáng của ảnh đơn sắc.
    # Kiểm tra không sinh hoa văn không gian rõ rệt.
    pixels = result.reshape(-1, 3).astype(np.int16)
    channel_ranges = pixels.max(axis=0) - pixels.min(axis=0)

    assert np.all(channel_ranges <= 2)


def test_increases_contrast_on_low_contrast_gradient():
    row = np.rint(
        np.linspace(100, 140, 128)
    ).astype(np.uint8)

    gray = np.tile(row, (128, 1))
    image = np.repeat(gray[..., None], 3, axis=2)

    result = enhance_clahe(
        image,
        {"clip_limit": 2.0, "tile_grid_size": 2},
    )

    before_lightness = cv2.cvtColor(
        image, cv2.COLOR_BGR2LAB
    )[..., 0]
    after_lightness = cv2.cvtColor(
        result, cv2.COLOR_BGR2LAB
    )[..., 0]

    # Đây là kỳ vọng cho ảnh thử cụ thể này,
    # không phải bảo đảm CLAHE tăng std trên mọi ảnh.
    assert after_lightness.astype(np.float32).std() > (
        before_lightness.astype(np.float32).std()
    )


def test_neutral_gray_remains_nearly_neutral():
    row = np.arange(32, 224, dtype=np.uint8)
    gray = np.tile(row, (64, 1))
    image = np.repeat(gray[..., None], 3, axis=2)

    result = enhance_clahe(
        image,
        {"clip_limit": 2.0, "tile_grid_size": 8},
    )

    pixels = result.astype(np.int16)
    channel_spread = (
        pixels.max(axis=2) - pixels.min(axis=2)
    )

    # Cho phép sai số do chuyển đổi Lab <-> BGR.
    assert channel_spread.max() <= 3


def test_moderate_color_does_not_shift_chroma_strongly():
    # Chọn màu vừa phải để tránh vùng màu bão hòa
    # dễ bị clipping khi thay đổi độ sáng.
    image = np.full(
        (64, 64, 3), (80, 100, 120), dtype=np.uint8
    )

    result = enhance_clahe(
        image,
        {"clip_limit": 2.0, "tile_grid_size": 8},
    )

    before_lab = cv2.cvtColor(
        image, cv2.COLOR_BGR2LAB
    ).astype(np.int16)
    after_lab = cv2.cvtColor(
        result, cv2.COLOR_BGR2LAB
    ).astype(np.int16)

    chroma_difference = np.abs(
        after_lab[..., 1:] - before_lab[..., 1:]
    )

    # Đánh giá a/b sau vòng chuyển đổi màu;
    # không yêu cầu BGR giữ nguyên vì L đã thay đổi.
    assert chroma_difference.max() <= 3


def test_defaults_match_explicit_parameters():
    rng = np.random.default_rng(7)
    image = rng.integers(
        40, 181, size=(32, 48, 3), dtype=np.uint8
    )
    params = {}

    implicit = enhance_clahe(image, params)
    explicit = enhance_clahe(
        image,
        {"clip_limit": 2.0, "tile_grid_size": 8},
    )

    np.testing.assert_array_equal(implicit, explicit)
    assert params == {}
