import numpy as np
import pytest

from app.algorithms.denoise import denoise_bilateral, denoise_median


MEDIAN_CASES = [
    {"kernel_size": 3},
    {"kernel_size": 5},
    {"kernel_size": 7},
]

BILATERAL_CASES = [
    {"diameter": 5, "sigma_color": 1, "sigma_space": 1},
    {"diameter": 5, "sigma_color": 50, "sigma_space": 50},
    {"diameter": 7, "sigma_color": 50, "sigma_space": 50},
    {"diameter": 9, "sigma_color": 150, "sigma_space": 150},
]

DENOISE_CASES = (
    [(denoise_median, params) for params in MEDIAN_CASES]
    + [(denoise_bilateral, params) for params in BILATERAL_CASES]
)


def mse(actual, expected):
    difference = (
        actual.astype(np.float32) - expected.astype(np.float32)
    )
    return float(np.mean(difference ** 2))


@pytest.mark.parametrize("function,params", DENOISE_CASES)
def test_output_contract_and_inputs_unchanged(function, params):
    rng = np.random.default_rng(42)
    image = rng.integers(
        0, 256, size=(24, 32, 3), dtype=np.uint8
    )
    before = image.copy()
    params_before = params.copy()

    result = function(image, params)

    assert result.shape == image.shape
    assert result.dtype == np.uint8
    assert not np.shares_memory(result, image)

    np.testing.assert_array_equal(image, before)
    assert params == params_before


@pytest.mark.parametrize("function,params", DENOISE_CASES)
@pytest.mark.parametrize(
    "shape",
    [
        (1, 1, 3),
        (1, 5, 3),
        (5, 1, 3),
        (2, 3, 3),
    ],
)
def test_small_images(function, params, shape):
    image = np.full(shape, (30, 100, 180), dtype=np.uint8)

    result = function(image, params)

    assert result.shape == shape
    assert result.dtype == np.uint8
    assert not np.shares_memory(result, image)


@pytest.mark.parametrize("function,params", DENOISE_CASES)
def test_uniform_color_is_preserved(function, params):
    image = np.full(
        (24, 32, 3), (30, 100, 180), dtype=np.uint8
    )

    result = function(image, params)

    # Bilateral có thể có sai số làm tròn rất nhỏ.
    np.testing.assert_allclose(result, image, atol=1, rtol=0)


@pytest.mark.parametrize("params", MEDIAN_CASES)
def test_median_removes_isolated_salt_and_pepper(params):
    clean = np.full((21, 21, 3), 120, dtype=np.uint8)
    noisy = clean.copy()

    noisy[5, 5] = 255
    noisy[15, 15] = 0

    result = denoise_median(noisy, params)

    np.testing.assert_array_equal(result, clean)
    assert mse(result, clean) < mse(noisy, clean)


@pytest.mark.parametrize("params", MEDIAN_CASES)
def test_median_removes_noise_at_image_border(params):
    clean = np.full((21, 21, 3), 120, dtype=np.uint8)
    noisy = clean.copy()

    # Điểm nhiễu ở hàng đầu, tránh góc ảnh vì padding
    # có thể nhân rộng điểm góc trong cửa sổ trung vị.
    noisy[0, 10] = 255

    result = denoise_median(noisy, params)

    np.testing.assert_array_equal(result, clean)


def test_bilateral_reduces_gaussian_noise_and_preserves_edge():
    rng = np.random.default_rng(42)

    clean = np.full((64, 64, 3), 60, dtype=np.uint8)
    clean[:, 32:] = 190

    noise = rng.normal(0, 10, size=clean.shape)
    noisy = np.clip(
        np.rint(clean.astype(np.float32) + noise),
        0,
        255,
    ).astype(np.uint8)

    result = denoise_bilateral(
        noisy,
        {
            "diameter": 5,
            "sigma_color": 50,
            "sigma_space": 50,
        },
    )

    # Đo giảm nhiễu trong vùng phẳng, tránh biên ảnh
    # và đường phân cách hai mức sáng.
    left = np.s_[8:56, 8:24, :]
    right = np.s_[8:56, 40:56, :]

    assert mse(result[left], clean[left]) < mse(
        noisy[left], clean[left]
    )
    assert mse(result[right], clean[right]) < mse(
        noisy[right], clean[right]
    )

    # Hai cột sát đường phân cách vẫn phải khác nhau rõ.
    dark_side = result[8:56, 31].astype(np.float32).mean()
    bright_side = result[8:56, 32].astype(np.float32).mean()

    assert bright_side - dark_side > 100


@pytest.mark.parametrize(
    "function,default_params",
    [
        (denoise_median, {"kernel_size": 3}),
        (
            denoise_bilateral,
            {
                "diameter": 5,
                "sigma_color": 50,
                "sigma_space": 50,
            },
        ),
    ],
)
def test_defaults_match_explicit_parameters(function, default_params):
    rng = np.random.default_rng(7)
    image = rng.integers(
        0, 256, size=(24, 32, 3), dtype=np.uint8
    )
    params = {}

    implicit = function(image, params)
    explicit = function(image, default_params)

    np.testing.assert_array_equal(implicit, explicit)
    assert params == {}
