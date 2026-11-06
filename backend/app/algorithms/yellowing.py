"""Member 3: estimate and reduce a global yellow cast in CIE Lab."""

import cv2
import numpy as np

from app.algorithms.types import ImageArray, StrengthParams
from app.algorithms.validation import validate_input


def remove_yellow_cast(image: ImageArray, params: StrengthParams) -> ImageArray:
    """Estimate warm illuminant from light, moderately neutral pixels.

    Only positive b* is corrected, preserving luminance and the red/green axis.
    This global white-balance estimate cannot distinguish a yellow subject from
    aged paper; strength blends the full correction with the untouched input.
    """
    strength = validate_input(image, "remove_yellow_cast", params)["strength"]
    if strength == 0:
        return image.copy()
    lab = cv2.cvtColor(image.astype(np.float32) / 255, cv2.COLOR_BGR2Lab)
    lightness, a, b = cv2.split(lab)
    candidates = (lightness >= max(15, float(np.percentile(lightness, 60)))) & (np.hypot(a, b) < 60)
    cast = float(np.clip(np.median(b[candidates]), 0, 35)) if candidates.any() else 0
    if cast < 0.5:
        return image.copy()
    # Fade near black to avoid tinting deep shadows.
    lab[:, :, 2] -= cast * np.clip(lightness / 25, 0, 1)
    corrected = cv2.cvtColor(lab, cv2.COLOR_Lab2BGR) * 255
    blended = image.astype(np.float32) * (1 - strength) + corrected * strength
    return np.rint(np.clip(blended, 0, 255)).astype(np.uint8)
