"""Detect thin bright/dark scratches, then fill with Telea inpainting.

Top/black-hat isolate narrow structures; directional opening rejects isolated
noise. This heuristic can confuse hair, wires or fabric with damage.
"""

import cv2
import numpy as np

from app.algorithms.types import ImageArray, MaskArray, ScratchParams
from app.algorithms.validation import validate_input


def detect_scratches(image: ImageArray, params: ScratchParams) -> MaskArray:
    """Return a binary uint8 mask; sensitivity 0 disables detection.

    Threshold = 60 - 45*sensitivity gray levels. Width is limited to about
    5 pixels; minimum line length is 9 pixels. Operates at original resolution.
    Higher sensitivity lowers the contrast threshold and admits more candidates.
    """
    config = validate_input(image, "reduce_scratches", dict(params))
    sensitivity = float(config["sensitivity"])
    mask = np.zeros(image.shape[:2], np.uint8)
    if sensitivity == 0 or min(mask.shape) < 9:
        return mask
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.medianBlur(gray, 3)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    bright = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel)
    dark = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
    threshold = 60 - 45 * sensitivity
    length = 9
    directions = [np.ones((1, length), np.uint8), np.ones((length, 1), np.uint8),
                  np.eye(length, dtype=np.uint8), np.fliplr(np.eye(length, dtype=np.uint8)).copy()]
    for residual in (bright, dark):
        candidate = np.uint8(residual > threshold) * 255
        lines = np.zeros_like(mask)
        for direction in directions:
            lines |= cv2.morphologyEx(candidate, cv2.MORPH_OPEN, direction)
        count, labels, stats, _ = cv2.connectedComponentsWithStats(lines, connectivity=8)
        accepted = np.zeros(count, np.uint8)
        for index in range(1, count):
            _, _, width, height, area = stats[index]
            major, minor = max(width, height), min(width, height)
            # Diagonal bounding boxes are square; area/major estimates thickness.
            if major >= length and area / major <= 6 and (major / minor >= 3 or area / major <= 5.5):
                accepted[index] = 255
        mask |= accepted[labels]
    return cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))


def reduce_scratches(image: ImageArray, params: ScratchParams) -> ImageArray:
    """Fill detected pixels using Telea, preserving all unmasked pixels."""
    config = validate_input(image, "reduce_scratches", dict(params))
    mask = detect_scratches(image, config)
    if not np.any(mask):
        return image.copy()
    return cv2.inpaint(image, mask, float(config["inpaint_radius"]), cv2.INPAINT_TELEA)
