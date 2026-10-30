import numpy as np
import pytest

from app.algorithms.brightness import adjust_gamma


@pytest.mark.parametrize("gamma", [0.1, 1.0, 3.0])
def test_output_contract_and_inputs_unchanged(gamma):
    rng = np.random.default_rng(42)
    image = rng.integers(
        0, 256, size=(24, 32, 3), dtype=np.uint8
    )
    before = image.copy()

    params = {"gamma": gamma}
    params_before = params.copy()

    result = adjust_gamma(image, params)

    assert result.shape == image.shape
    assert result.dtype == np.uint8
    assert not np.shares_memory(result, image)

    np.testing.assert_array_equal(image, before)
    assert params == params_before


def test_gamma_one_returns_independent_copy():
    rng = np.random.default_rng(10)
    image = rng.integers(
        0, 256, size=(16, 16, 3), dtype=np.uint8
    )

    result = adjust_gamma(image, {"gamma": 1})

    np.testing.assert_array_equal(result, image)
    assert not np.shares_memory(result, image)

    original_pixel = image[0, 0].copy()
    result[0, 0] = 0

    np.testing.assert_array_equal(image[0, 0], original_pixel)


def test_gamma_greater_than_one_brightens_midtones():
    values = np.array([32, 64, 128, 192], dtype=np.uint8)
    image = np.repeat(values[None, :, None], 3, axis=2)

    result = adjust_gamma(image, {"gamma": 2})

    assert np.all(result > image)


def test_gamma_less_than_one_darkens_midtones():
    values = np.array([32, 64, 128, 192], dtype=np.uint8)
    image = np.repeat(values[None, :, None], 3, axis=2)

    result = adjust_gamma(image, {"gamma": 0.5})

    assert np.all(result < image)


@pytest.mark.parametrize(
    "gamma,expected",
    [
        (0.5, 16),
        (1.0, 64),
        (2.0, 128),
    ],
)
def test_known_pixel_values(gamma, expected):
    image = np.full((3, 4, 3), 64, dtype=np.uint8)

    result = adjust_gamma(image, {"gamma": gamma})

    # Dung sai 1 cho khác biệt làm tròn.
    np.testing.assert_allclose(
        result, expected, atol=1, rtol=0
    )


@pytest.mark.parametrize("gamma", [0.1, 0.5, 1.0, 2.0, 3.0])
def test_black_and_white_are_preserved(gamma):
    image = np.zeros((4, 8, 3), dtype=np.uint8)
    image[:, 4:] = 255

    result = adjust_gamma(image, {"gamma": gamma})

    np.testing.assert_array_equal(result, image)


@pytest.mark.parametrize("gamma", [0.1, 1.0, 3.0])
def test_intensity_mapping_is_monotonic(gamma):
    values = np.arange(256, dtype=np.uint8)
    image = np.repeat(values[None, :, None], 3, axis=2)

    result = adjust_gamma(image, {"gamma": gamma})

    # Chuyển sang kiểu có dấu trước khi tính hiệu.
    differences = np.diff(result[0, :, 0].astype(np.int16))

    assert np.all(differences >= 0)


@pytest.mark.parametrize("gamma", [0.1, 1.0, 3.0])
def test_color_channel_order_is_preserved(gamma):
    # B < G < R; gamma là phép ánh xạ đơn điệu
    # giống nhau cho cả ba kênh.
    image = np.full(
        (8, 8, 3), (40, 100, 180), dtype=np.uint8
    )

    result = adjust_gamma(image, {"gamma": gamma})

    assert np.all(result[..., 0] <= result[..., 1])
    assert np.all(result[..., 1] <= result[..., 2])


@pytest.mark.parametrize("gamma", [0.1, 1.0, 3.0])
@pytest.mark.parametrize(
    "shape",
    [
        (1, 1, 3),
        (1, 5, 3),
        (5, 1, 3),
        (2, 3, 3),
    ],
)
def test_small_images(gamma, shape):
    image = np.full(shape, 100, dtype=np.uint8)

    result = adjust_gamma(image, {"gamma": gamma})

    assert result.shape == shape
    assert result.dtype == np.uint8
    assert not np.shares_memory(result, image)


def test_default_gamma_is_one():
    image = np.full(
        (8, 8, 3), (40, 100, 180), dtype=np.uint8
    )
    params = {}

    result = adjust_gamma(image, params)

    np.testing.assert_array_equal(result, image)
    assert not np.shares_memory(result, image)
    assert params == {}
