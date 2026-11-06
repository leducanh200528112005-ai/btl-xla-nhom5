"""Shared validation for implemented BGR algorithms, including direct callers."""

import numpy as np

from app.catalog import validate_and_fill_params


def validate_input(image, algorithm: str, params: dict) -> dict[str, int | float]:
    if (
        not isinstance(image, np.ndarray)
        or image.dtype != np.uint8
        or image.ndim != 3
        or image.shape[2] != 3
        or image.shape[0] == 0
        or image.shape[1] == 0
    ):
        raise ValueError("Expected a nonempty H x W x 3 BGR uint8 image.")
    return validate_and_fill_params(algorithm, params)
