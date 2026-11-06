
"""Scratch detection and reduction using morphology and inpainting."""

from __future__ import annotations

import cv2
import numpy as np

from app.algorithms.types import ImageArray, MaskArray, ScratchParams
from app.algorithms.validation import validate_input


def detect_scratches(
    image: ImageArray,
    params: ScratchParams,
) -> MaskArray:
    """Detect thin bright or dark scratches in a BGR image.

    Returns:
        A binary uint8 mask with the same height and width:
        - 0: preserve pixel.
        - 255: repair pixel.

    Sensitivity ranges from 0 to 1.
    Higher sensitivity lowers the detection threshold.
    Sensitivity = 0 disables detection.
    """
    config = validate_input(
        image,
        "reduce_scratches",
        dict(params),
    )

    sensitivity = float(config["sensitivity"])

    mask = np.zeros(image.shape[:2], dtype=np.uint8)

    # Disable detection for zero sensitivity or tiny images.
    if sensitivity == 0 or min(mask.shape) < 9:
        return mask

    # Convert BGR image to grayscale.
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Extract bright and dark details using morphology.
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (7, 7),
    )

    bright = cv2.morphologyEx(
        gray,
        cv2.MORPH_TOPHAT,
        kernel,
    )

    dark = cv2.morphologyEx(
        gray,
        cv2.MORPH_BLACKHAT,
        kernel,
    )

    # Higher sensitivity produces a lower threshold.
    threshold = 60.0 - 45.0 * sensitivity

    length = 9

    # Line-shaped kernels for four directions.
    directions = [
        np.ones((1, length), dtype=np.uint8),
        np.ones((length, 1), dtype=np.uint8),
        np.eye(length, dtype=np.uint8),
        np.fliplr(
            np.eye(length, dtype=np.uint8)
        ).copy(),
    ]

    # Process bright and dark scratches separately.
    for residual in (bright, dark):
        candidate = np.uint8(
            residual > threshold
        ) * 255

        lines = np.zeros_like(mask)

        # Keep structures that match line-shaped kernels.
        for direction in directions:
            opened = cv2.morphologyEx(
                candidate,
                cv2.MORPH_OPEN,
                direction,
            )
            lines |= opened

        # Analyze connected components.
        count, labels, stats, _ = (
            cv2.connectedComponentsWithStats(
                lines,
                connectivity=8,
            )
        )

        accepted = np.zeros(
            count,
            dtype=np.uint8,
        )

        for index in range(1, count):
            _, _, width, height, area = stats[index]

            major = max(width, height)
            minor = max(1, min(width, height))

            # Ignore short structures.
            if major < length:
                continue

            thickness = area / major
            aspect_ratio = major / minor

            # Accept long and relatively thin structures.
            if (
                thickness <= 6
                and (
                    aspect_ratio >= 3
                    or thickness <= 5.5
                )
            ):
                accepted[index] = 255

        mask |= accepted[labels]

    # Expand the mask slightly to cover scratch boundaries.
    dilation_kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (3, 3),
    )

    mask = cv2.dilate(
        mask,
        dilation_kernel,
    )

    return mask


def reduce_scratches(
    image: ImageArray,
    params: ScratchParams,
) -> ImageArray:
    """Repair detected scratches using Telea inpainting.

    The input image is never modified.
    If no scratches are detected, return an independent copy.
    """
    config = validate_input(
        image,
        "reduce_scratches",
        dict(params),
    )

    mask = detect_scratches(
        image,
        config,
    )

    if not np.any(mask):
        return image.copy()

    result = cv2.inpaint(
        image,
        mask,
        float(config["inpaint_radius"]),
        cv2.INPAINT_TELEA,
    )

    return result
