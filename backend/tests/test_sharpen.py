
import cv2
import numpy as np
import pytest

from app.algorithms.scratches import detect_scratches, reduce_scratches


@pytest.fixture
def scratched_image():
    image = np.full((100, 100, 3), 120, dtype=np.uint8)
    cv2.line(image, (15, 50), (85, 50), (255, 255, 255), 1)
    return image


def test_detect_mask_format(scratched_image):
    mask = detect_scratches(
        scratched_image,
        {"sensitivity": 0.5, "inpaint_radius": 3},
    )

    assert mask.shape == scratched_image.shape[:2]
    assert mask.dtype == np.uint8
    assert set(np.unique(mask)).issubset({0, 255})


def test_detect_bright_scratch(scratched_image):
    mask = detect_scratches(
        scratched_image,
        {"sensitivity": 0.5, "inpaint_radius": 3},
    )

    assert np.any(mask == 255)


def test_detect_dark_scratch():
    image = np.full((100, 100, 3), 180, dtype=np.uint8)
    cv2.line(image, (15, 50), (85, 50), (0, 0, 0), 1)

    mask = detect_scratches(
        image,
        {"sensitivity": 0.5, "inpaint_radius": 3},
    )

    assert np.any(mask == 255)


def test_higher_sensitivity_detects_at_least_as_many_pixels(
    scratched_image,
):
    low_mask = detect_scratches(
        scratched_image,
        {"sensitivity": 0.2, "inpaint_radius": 3},
    )

    high_mask = detect_scratches(
        scratched_image,
        {"sensitivity": 0.8, "inpaint_radius": 3},
    )

    assert np.count_nonzero(high_mask) >= np.count_nonzero(low_mask)


def test_uniform_image_has_empty_mask():
    image = np.full((100, 100, 3), 120, dtype=np.uint8)

    mask = detect_scratches(
        image,
        {"sensitivity": 0.5, "inpaint_radius": 3},
    )

    assert not np.any(mask)


def test_reduce_output_format(scratched_image):
    result = reduce_scratches(
        scratched_image,
        {"sensitivity": 0.5, "inpaint_radius": 3},
    )

    assert result.shape == scratched_image.shape
    assert result.dtype == np.uint8


def test_reduce_does_not_modify_input(scratched_image):
    original = scratched_image.copy()

    reduce_scratches(
        scratched_image,
        {"sensitivity": 0.5, "inpaint_radius": 3},
    )

    assert np.array_equal(scratched_image, original)


def test_empty_mask_returns_copy():
    image = np.full((100, 100, 3), 120, dtype=np.uint8)

    result = reduce_scratches(
        image,
        {"sensitivity": 0.5, "inpaint_radius": 3},
    )

    assert np.array_equal(result, image)
    assert result is not image


@pytest.mark.parametrize(
    "params",
    [
        {"sensitivity": -0.1, "inpaint_radius": 3},
        {"sensitivity": 1.1, "inpaint_radius": 3},
        {"sensitivity": 0.5, "inpaint_radius": 0},
        {"sensitivity": 0.5, "inpaint_radius": 11},
    ],
)
def test_invalid_parameters(params):
    image = np.full((50, 50, 3), 120, dtype=np.uint8)

    with pytest.raises(ValueError):
        detect_scratches(image, params)
