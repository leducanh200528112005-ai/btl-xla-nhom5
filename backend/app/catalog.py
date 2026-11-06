# Cầu nối với ToolsPanel.tsx: GET /api/algorithms trả nhãn, kiểu control,
# options, min/max/step/default; frontend dùng chúng để dựng và reset cấu hình.
# id là ProcessingStep.algorithm; tool_id khớp ToolId trong frontend/src/types/api.ts.
# Có 9 thuật toán nhưng 8 nhóm: Median và Bilateral cùng thuộc denoise.
# Giá trị chuẩn nằm trong docs/api-contract.md; không đổi riêng BE hoặc FE.
# implementation_status công bố các thuật toán đã ghép; catalog không thực thi xử lý ảnh.

"""The single source of algorithm metadata and parameter validation."""

from dataclasses import dataclass
import math
from typing import Literal

ToolId = Literal[
    "denoise",
    "brightness",
    "contrast",
    "sharpen",
    "scratches",
    "yellowing",
    "colorize",
    "upscale",
]


@dataclass(frozen=True)
class ParameterOption:
    value: int
    label: str


@dataclass(frozen=True)
class ParameterSpec:
    key: str
    label: str
    description: str
    kind: Literal["number", "select"]
    default: int | float
    integer: bool
    minimum: int | float | None = None
    maximum: int | float | None = None
    step: int | float | None = None
    options: tuple[ParameterOption, ...] = ()


@dataclass(frozen=True)
class AlgorithmSpec:
    id: str
    tool_id: ToolId
    name: str
    description: str
    params: tuple[ParameterSpec, ...]
    implementation_status: Literal["not_implemented", "implemented"] = "not_implemented"


def _number(
    key: str,
    label: str,
    description: str,
    default: int | float,
    minimum: int | float,
    maximum: int | float,
    step: int | float,
    *,
    integer: bool = False,
) -> ParameterSpec:
    return ParameterSpec(
        key=key,
        label=label,
        description=description,
        kind="number",
        default=default,
        integer=integer,
        minimum=minimum,
        maximum=maximum,
        step=step,
    )


def _select(
    key: str,
    label: str,
    description: str,
    default: int,
    options: tuple[int, ...],
) -> ParameterSpec:
    return ParameterSpec(
        key=key,
        label=label,
        description=description,
        kind="select",
        default=default,
        integer=True,
        options=tuple(ParameterOption(value, str(value)) for value in options),
    )


ALGORITHMS: tuple[AlgorithmSpec, ...] = (
    AlgorithmSpec(
        "denoise_median",
        "denoise",
        "Lọc trung vị",
        "Giảm nhiễu bằng phương pháp trung vị.",
        (_select("kernel_size", "Kích thước kernel", "Kích thước lân cận lọc.", 3, (3, 5, 7)),),
    ),
    AlgorithmSpec(
        "denoise_bilateral",
        "denoise",
        "Lọc song phương",
        "Giảm nhiễu trong khi dự kiến bảo toàn biên ảnh.",
        (
            _select("diameter", "Đường kính", "Đường kính vùng lân cận.", 5, (5, 7, 9)),
            _number("sigma_color", "Sigma màu", "Mức ảnh hưởng của chênh lệch màu.", 50, 1, 150, 1),
            _number("sigma_space", "Sigma không gian", "Mức ảnh hưởng của khoảng cách không gian.", 50, 1, 150, 1),
        ),
    ),
    AlgorithmSpec(
        "adjust_gamma",
        "brightness",
        "Hiệu chỉnh gamma",
        "Điều chỉnh độ sáng theo tham số gamma.",
        (_number("gamma", "Gamma", "Giá trị lớn hơn 1 dự kiến làm ảnh sáng hơn.", 1, 0.1, 3, 0.05),),
    ),
    AlgorithmSpec(
        "enhance_clahe",
        "contrast",
        "Tăng tương phản cục bộ",
        "Tăng tương phản cục bộ bằng CLAHE.",
        (
            _number("clip_limit", "Giới hạn tương phản", "Giới hạn tăng tương phản cục bộ.", 2, 0.1, 10, 0.1),
            _number("tile_grid_size", "Số ô mỗi chiều", "Số ô trên mỗi chiều của lưới vuông.", 8, 2, 16, 1, integer=True),
        ),
    ),
    AlgorithmSpec(
        "sharpen_unsharp",
        "sharpen",
        "Làm nét unsharp",
        "Tăng độ nét theo cấu hình unsharp mask.",
        (
            _number("amount", "Mức làm nét", "Cường độ làm nét dự kiến.", 0.8, 0, 3, 0.05),
            _number("sigma", "Sigma", "Độ rộng làm mờ dùng trong phương pháp.", 1, 0.1, 5, 0.1),
        ),
    ),
    AlgorithmSpec(
        "reduce_scratches",
        "scratches",
        "Giảm vết xước",
        "Dự kiến phát hiện và giảm vết xước trên ảnh.",
        (
            _number("sensitivity", "Độ nhạy", "Mức nhạy dự kiến khi phát hiện vùng xước.", 0.5, 0, 1, 0.05),
            _number("inpaint_radius", "Bán kính nội suy", "Bán kính xử lý vùng xước dự kiến.", 3, 1, 10, 1, integer=True),
        ),
    ),
    AlgorithmSpec(
        "remove_yellow_cast",
        "yellowing",
        "Khử ám vàng",
        "Giảm ám vàng toàn ảnh trong không gian Lab; giảm cường độ nếu ảnh có chủ thể màu vàng.",
        (_number("strength", "Cường độ", "0 giữ nguyên; 1 áp dụng toàn bộ mức giảm ám vàng.", 0.5, 0, 1, 0.05),),
        implementation_status="implemented",
    ),
    AlgorithmSpec(
        "colorize_image",
        "colorize",
        "Tô màu ảnh",
        "Tô màu bằng mô hình ECCV16 trên CPU. Màu là dự đoán, có thể khác màu thực tế.",
        (_number("strength", "Cường độ", "Mức trộn kết quả tô màu với ảnh đầu vào.", 1, 0, 1, 0.05),),
        implementation_status="implemented",
    ),
    AlgorithmSpec(
        "upscale_image",
        "upscale",
        "Phóng to ảnh",
        "Phóng 2× hoặc 4× bằng nội suy Lanczos; không khôi phục chi tiết đã mất bằng AI.",
        (_select("scale", "Hệ số phóng", "Hệ số phóng ảnh.", 2, (2, 4)),),
        implementation_status="implemented",
    ),
)

ALGORITHM_BY_ID = {algorithm.id: algorithm for algorithm in ALGORITHMS}


class CatalogValidationError(ValueError):
    """Raised when parameters do not match the canonical catalog definition."""


def validate_and_fill_params(
    algorithm_id: str, params: dict[str, int | float]
) -> dict[str, int | float]:
    """Validate parameter values and fill omitted values from the catalog defaults."""

    algorithm = ALGORITHM_BY_ID.get(algorithm_id)
    if algorithm is None:
        raise CatalogValidationError("unknown algorithm")

    specs = {parameter.key: parameter for parameter in algorithm.params}
    unknown = params.keys() - specs.keys()
    if unknown:
        raise CatalogValidationError("unknown parameter")

    normalized: dict[str, int | float] = {}
    for key, spec in specs.items():
        value = params.get(key, spec.default)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise CatalogValidationError("parameter must be numeric")
        if spec.integer and type(value) is not int:
            raise CatalogValidationError("parameter must be an integer")
        try:
            is_finite = math.isfinite(value)
        except OverflowError:
            is_finite = False
        if not is_finite:
            raise CatalogValidationError("parameter must be finite")
        if spec.kind == "select":
            if value not in {option.value for option in spec.options}:
                raise CatalogValidationError("parameter is not an available option")
        elif value < spec.minimum or value > spec.maximum:
            raise CatalogValidationError("parameter is outside its allowed range")
        normalized[key] = value
    return normalized


def catalog_descriptors() -> list[dict[str, object]]:
    """Create API descriptors directly from the same specs used for validation."""

    return [
        {
            "id": algorithm.id,
            "tool_id": algorithm.tool_id,
            "name": algorithm.name,
            "description": algorithm.description,
            "implementation_status": algorithm.implementation_status,
            "params": [
                {
                    "key": parameter.key,
                    "label": parameter.label,
                    "description": parameter.description,
                    "kind": parameter.kind,
                    "default": parameter.default,
                    "integer": parameter.integer,
                    "min": parameter.minimum,
                    "max": parameter.maximum,
                    "step": parameter.step,
                    "options": [
                        {"value": option.value, "label": option.label}
                        for option in parameter.options
                    ],
                }
                for parameter in algorithm.params
            ],
        }
        for algorithm in ALGORITHMS
    ]
