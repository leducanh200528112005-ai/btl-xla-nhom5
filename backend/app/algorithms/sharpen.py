
"""Image sharpening using unsharp masking."""

from __future__ import annotations

import cv2
import numpy as np

from app.algorithms.types import ImageArray, UnsharpParams
from app.algorithms.validation import validate_input


def sharpen_unsharp(
    image: ImageArray,
    params: UnsharpParams,
) -> ImageArray:
    """Sharpen a BGR uint8 image using the unsharp mask method.

    Formula:
        sharpened = image + amount * (image - GaussianBlur(image, sigma))

    Args:
        image: Input BGR image with dtype uint8.
        params: Parameters containing amount and sigma.

    Returns:
        A new sharpened image with the same shape and dtype.

    Notes:
        - amount ranges from 0 to 3.
        - sigma ranges from 0.1 to 5.
        - amount = 0 returns an unchanged copy.
        - High sharpening amounts may amplify noise and create halos.
    """
    # Validate image and parameters using the shared validator.
    config = validate_input(
        image,
        "sharpen_unsharp",
        dict(params),
    )

    amount = float(config["amount"])
    sigma = float(config["sigma"])

    # Return an independent copy when sharpening is disabled.
    if amount == 0:
        return image.copy()

    # Convert to floating point to avoid uint8 overflow/underflow.
    source = image.astype(np.float32)

    # Create a Gaussian-blurred version of the image.
    blurred = cv2.GaussianBlur(
        source,
        (0, 0),
        sigmaX=sigma,
        sigmaY=sigma,
        borderType=cv2.BORDER_REFLECT_101,
    )

    # Extract high-frequency details.
    detail = source - blurred

    # Add details back to the original image.
    sharpened = source + amount * detail

    # Clip values to the valid uint8 range and convert back.
    result = np.clip(
        np.rint(sharpened),
        0,
        255,
    ).astype(np.uint8)

    return result
