
"""Scratch detection and reduction using morphological filters and inpainting."""

from __future__ import annotations

import cv2
import numpy as np

from app.algorithms.types import ImageArray, MaskArray, ScratchParams


def _validate_inputs(image: ImageArray, params: ScratchParams) -> None:
    """Validate image and scratch parameters."""
    if not isinstance(image, np.ndarray):
        raise TypeError("image must be a NumPy array")

    if image.dtype != np.uint8:
        raise TypeError("image must have dtype uint8")

    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("image must have shape (H, W, 3)")

    if image.shape[0] == 0 or image.shape[1] == 0:
        raise ValueError("image must not be empty")

    sensitivity = params["sensitivity"]
    radius = params["inpaint_radius"]

    if not np.isfinite(sensitivity) or not 0 <= sensitivity <= 1:
        raise ValueError("sensitivity must be between 0 and 1")

    if isinstance(radius, bool) or not isinstance(radius, int):
        raise TypeError("inpaint_radius must be an integer")

    if not 1 <= radius <= 10:
        raise ValueError("inpaint_radius must be between 1 and 10")


def _make_line_kernel(angle: int, size: int = 15) -> np.ndarray:
    """Create a thin line-shaped morphological kernel."""
    kernel = np.zeros((size, size), dtype=np.uint8)
    center = size // 2
    half = center

    radians = np.deg2rad(angle)
    dx = int(round(half * np.cos(radians)))
    dy = int(round(half * np.sin(radians)))

    cv2.line(
        kernel,
        (center - dx, center - dy),
        (center + dx, center + dy),
        1,
        thickness=1,
    )

    return kernel


def detect_scratches(image: ImageArray, params: ScratchParams) -> MaskArray:
    """Detect thin bright or dark scratches and return a binary mask."""
    _validate_inputs(image, params)

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Bright scratches are detected by top-hat;
    # dark scratches are detected by black-hat.
    responses = []

    for angle in (0, 45, 90, 135):
        kernel = _make_line_kernel(angle)

        bright = cv2.morphologyEx(
            gray, cv2.MORPH_TOPHAT, kernel
        )
        dark = cv2.morphologyEx(
            gray, cv2.MORPH_BLACKHAT, kernel
        )

        responses.append(cv2.max(bright, dark))

    response = responses[0]
    for item in responses[1:]:
        response = cv2.max(response, item)

    # Higher sensitivity means a lower detection threshold.
    threshold = int(round(40 - 30 * float(params["sensitivity"])))

    mask = np.where(response >= threshold, 255, 0).astype(np.uint8)

    return mask


def reduce_scratches(image: ImageArray, params: ScratchParams) -> ImageArray:
    """Detect scratches internally and reduce them using inpainting."""
    _validate_inputs(image, params)

    mask = detect_scratches(image, params)

    if not np.any(mask):
        return image.copy()

    restored = cv2.inpaint(
        image,
        mask,
        float(params["inpaint_radius"]),
        cv2.INPAINT_TELEA,
    )

    return restored
