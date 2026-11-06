
"""Sharpening algorithm using an unsharp mask."""

from __future__ import annotations

import cv2
import numpy as np

from app.algorithms.types import ImageArray, UnsharpParams


def sharpen_unsharp(image: ImageArray, params: UnsharpParams) -> ImageArray:
    """Apply unsharp-mask sharpening to a BGR uint8 image."""
    if not isinstance(image, np.ndarray):
        raise TypeError("image must be a NumPy array")

    if image.dtype != np.uint8:
        raise TypeError("image must have dtype uint8")

    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("image must have shape (H, W, 3)")

    if image.shape[0] == 0 or image.shape[1] == 0:
        raise ValueError("image must not be empty")

    amount = float(params["amount"])
    sigma = float(params["sigma"])

    if not np.isfinite(amount) or not 0 <= amount <= 3:
        raise ValueError("amount must be between 0 and 3")

    if not np.isfinite(sigma) or not 0.1 <= sigma <= 5:
        raise ValueError("sigma must be between 0.1 and 5")

    if amount == 0:
        return image.copy()

    image_float = image.astype(np.float32)

    blurred = cv2.GaussianBlur(
        image_float,
        (0, 0),
        sigmaX=sigma,
        sigmaY=sigma,
    )

    detail = image_float - blurred
    sharpened = image_float + amount * detail

    return np.clip(sharpened, 0, 255).astype(np.uint8)
