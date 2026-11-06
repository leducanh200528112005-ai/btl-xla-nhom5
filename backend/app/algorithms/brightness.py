# FE: "Điều chỉnh độ sáng", tool_id=brightness, algorithm=adjust_gamma.
# params.gamma: 0.1..3, bước UI 0.05, mặc định 1; số JSON, không nhận chuỗi.
# Quy ước out = in^(1/gamma): gamma > 1 sáng hơn, không dùng quy ước ngược.
# Input/output BGR uint8 cùng kích thước; hiện chưa tác động lên preview FE.

"""Brightness algorithm implementations."""

from __future__ import annotations

from app.algorithms.types import GammaParams, ImageArray
from app.algorithms.validation import validate_input

import numpy as np


def adjust_gamma(image: ImageArray, params: GammaParams) -> ImageArray:
    """Adjust brightness using the ``out = in ** (1 / gamma)`` convention.

    Args:
        image: BGR uint8 NumPy image array.
        params: ``gamma`` from the catalog, strictly greater than zero.

    Returns:
        A brightness-adjusted BGR uint8 array with unchanged dimensions.
    """

    config = validate_input(image, "adjust_gamma", dict(params))
    gamma = float(config["gamma"])

    if gamma == 1.0:
        return image.copy()

    normalized = image.astype(np.float32) / 255.0
    corrected = np.power(normalized, 1.0 / gamma) * 255.0

    return np.clip(np.rint(corrected), 0, 255).astype(np.uint8)
