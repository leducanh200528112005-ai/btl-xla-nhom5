# Kiểu nội bộ cho thuật toán, không phải schema kiểm tra HTTP (xem schemas/models.py).
# PipelineStep tương ứng ProcessingStep của FE; TypedDict không tự validate dữ liệu.
# ImageArray: NumPy uint8 BGR; MaskArray: uint8 một kênh, cùng kích thước ảnh.
# Ảnh truyền qua HTTP là file JPEG/PNG hoặc URL, không phải mảng NumPy.
# AdviceResult khớp AdviceResponse; reason là giải thích cho từng bước đề xuất.

"""Type-only conventions for future algorithm implementations."""

from typing import TYPE_CHECKING, TypeAlias, TypedDict

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray

ImageArray: TypeAlias = "NDArray[np.uint8]"
MaskArray: TypeAlias = "NDArray[np.uint8]"


class MedianParams(TypedDict):
    kernel_size: int


class BilateralParams(TypedDict):
    diameter: int
    sigma_color: int | float
    sigma_space: int | float


class GammaParams(TypedDict):
    gamma: int | float


class ClaheParams(TypedDict):
    clip_limit: int | float
    tile_grid_size: int


class UnsharpParams(TypedDict):
    amount: int | float
    sigma: int | float


class ScratchParams(TypedDict):
    sensitivity: int | float
    inpaint_radius: int


class StrengthParams(TypedDict):
    strength: int | float


class UpscaleParams(TypedDict):
    scale: int


class PipelineStep(TypedDict):
    algorithm: str
    params: dict[str, int | float]


class AdvisedStep(PipelineStep):
    reason: str


class AdviceResult(TypedDict):
    decision: str
    analysis: str
    steps: list[AdvisedStep]
