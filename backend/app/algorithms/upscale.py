"""Member 4: CPU Lanczos interpolation at 2x or 4x (not AI super-resolution)."""

import cv2

from app.algorithms.types import ImageArray, UpscaleParams
from app.algorithms.validation import validate_input


def upscale_image(image: ImageArray, params: UpscaleParams) -> ImageArray:
    """Return a new BGR image with exactly scale times each input dimension.

    The pipeline enforces its output pixel budget before this allocation.
    Lanczos reconstructs a smooth enlarged image; it cannot recover lost detail.
    """
    scale = validate_input(image, "upscale_image", params)["scale"]
    height, width = image.shape[:2]
    return cv2.resize(image, (width * scale, height * scale), interpolation=cv2.INTER_LANCZOS4)
