"""Execute member 3/4 algorithms in validated request order."""

from collections.abc import Sequence
from pathlib import Path

import numpy as np

from app.algorithms.colorize import colorize_image
from app.algorithms.upscale import upscale_image
from app.algorithms.yellowing import remove_yellow_cast
from app.algorithms.types import ImageArray, PipelineStep
from app.catalog import ALGORITHM_BY_ID, validate_and_fill_params
from app.errors import ApiError

IMPLEMENTED_ALGORITHMS = {
    "remove_yellow_cast": remove_yellow_cast,
    "colorize_image": colorize_image,
    "upscale_image": upscale_image,
}


def prepare_steps(steps: Sequence[PipelineStep]) -> list[PipelineStep]:
    """Preflight every step before executing any; never skip unfinished tools."""
    if not 1 <= len(steps) <= 8:
        raise ValueError("Expected 1 to 8 steps")
    prepared = []
    seen = set()
    for index, step in enumerate(steps):
        name = step["algorithm"]
        params = validate_and_fill_params(name, step["params"])
        tool = ALGORITHM_BY_ID[name].tool_id
        if tool in seen or (tool == "upscale" and index != len(steps) - 1):
            raise ValueError("Duplicate tool or upscale is not last")
        seen.add(tool)
        prepared.append({"algorithm": name, "params": params})
    if any(step["algorithm"] not in IMPLEMENTED_ALGORITHMS for step in prepared):
        raise ApiError(501, "NOT_IMPLEMENTED", "Chức năng xử lý ảnh chưa được triển khai.")
    return prepared


def check_output_size(width: int, height: int, steps: Sequence[PipelineStep], limit: int) -> None:
    scale = next((step["params"]["scale"] for step in steps if step["algorithm"] == "upscale_image"), 1)
    if width * height * scale * scale > limit:
        raise ApiError(422, "IMAGE_TOO_LARGE", "Ảnh kết quả vượt giới hạn số pixel. Hãy giảm hệ số phóng hoặc dùng ảnh nhỏ hơn.")


def process_image(
    original: ImageArray,
    steps: Sequence[PipelineStep],
    *,
    max_result_pixels: int = 32_000_000,
    model_dir: Path | None = None,
) -> ImageArray:
    """Process BGR uint8 pixels without mutating the caller's original."""
    prepared = prepare_steps(steps)
    if not isinstance(original, np.ndarray) or original.ndim != 3 or original.shape[2] != 3 or original.dtype != np.uint8 or original.size == 0:
        raise ValueError("Expected a nonempty BGR uint8 image")
    check_output_size(original.shape[1], original.shape[0], prepared, max_result_pixels)
    current = original.copy()
    for step in prepared:
        function = IMPLEMENTED_ALGORITHMS[step["algorithm"]]
        if step["algorithm"] == "colorize_image":
            current = function(current, step["params"], model_dir=model_dir)
        else:
            current = function(current, step["params"])
    return current
