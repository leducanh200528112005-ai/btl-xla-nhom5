# FE: "Tăng tương phản", tool_id=contrast, algorithm=enhance_clahe; người 1.
# clip_limit: 0.1..10, bước UI 0.1, mặc định 2.
# tile_grid_size: integer 2..16, mặc định 8; là số ô trên MỖI chiều,
# khi triển khai chuyển n thành (n,n), không hiểu n là kích thước pixel.
# Input/output dự kiến BGR uint8 cùng kích thước; hiện là stub.

"""Contrast algorithm interfaces (intentionally unimplemented)."""

from __future__ import annotations

from app.algorithms.types import ClaheParams, ImageArray
from app.catalog import validate_and_fill_params

import cv2


def enhance_clahe(image: ImageArray, params: ClaheParams) -> ImageArray:
    """Enhance local contrast with CLAHE in a future implementation.

    Args:
        image: BGR uint8 NumPy image array.
        params: ``clip_limit`` and square-grid tile count ``tile_grid_size``.

    Returns:
        A contrast-enhanced BGR uint8 array with unchanged dimensions.
    """
    # raise NotImplementedError("CLAHE contrast enhancement is not implemented.")

    config = validate_and_fill_params("enhance_clahe", dict(params))
    grid_size = int(config["tile_grid_size"])

    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    lightness, channel_a, channel_b = cv2.split(lab)

    clahe = cv2.createCLAHE(
        clipLimit=float(config["clip_limit"]),
        tileGridSize=(grid_size, grid_size)
    )

    enhanced_lightness = clahe.apply(lightness)

    enhanced_lab = cv2.merge((enhanced_lightness, channel_a, channel_b))

    return cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)
