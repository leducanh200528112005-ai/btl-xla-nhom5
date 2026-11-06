"""Unsharp masking with floating-point arithmetic and saturating output."""

import cv2
import numpy as np

from app.algorithms.types import ImageArray, UnsharpParams
from app.algorithms.validation import validate_input


def sharpen_unsharp(image: ImageArray, params: UnsharpParams) -> ImageArray:
    """Return I + amount * (I - Gaussian(I, sigma)), without modifying I.

    BGR uint8 input/output have the same dimensions. amount=0 is exact identity.
    Sharpening can amplify noise and produce halos at high amounts.
    """
    config = validate_input(image, "sharpen_unsharp", dict(params))
    amount = float(config["amount"])
    if amount == 0:
        return image.copy()
    source = image.astype(np.float32)
    blurred = cv2.GaussianBlur(source, (0, 0), float(config["sigma"]),
                               borderType=cv2.BORDER_REFLECT_101)
    return np.clip(np.rint(source + amount * (source - blurred)), 0, 255).astype(np.uint8)
