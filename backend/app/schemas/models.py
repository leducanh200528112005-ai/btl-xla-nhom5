# Mapping FE: UploadResponse <-> ImageAsset; ProcessRequest <-> ProcessRequest;
# AdviseRequest <-> AdviceRequest; ProcessResultResponse <-> ProcessResult.
# ProcessingStep nhận {algorithm, params}; params là số JSON, không phải string/bool.
# ToolsPanel chuyển giá trị select thành số trước khi serializer gửi lên.
# _validate_steps chỉ kiểm tra nhóm trùng và upscale cuối, không tự đổi thứ tự.
# FE serializeSteps() bỏ nhóm tắt; process cần 1..8 bước, advise cho phép 0..8.
# ErrorResponse khớp ApiErrorEnvelope; model kết quả là shape tương lai, chưa trả thật.

"""Strict API schemas. Catalog validation remains centralized in ``catalog``."""

from typing import Annotated, Literal
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictFloat,
    StrictInt,
    StrictStr,
    UUID4,
    field_validator,
    model_validator,
)

from app.catalog import ALGORITHM_BY_ID, CatalogValidationError, ToolId, validate_and_fill_params


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ErrorDetail(StrictModel):
    field: str
    message: str


class ErrorInfo(StrictModel):
    code: str
    message: str
    details: list[ErrorDetail] | None = None


class ErrorResponse(StrictModel):
    error: ErrorInfo


class HealthResponse(StrictModel):
    status: Literal["ok"]
    app: Literal["resim"]
    version: str


class ParameterOptionResponse(StrictModel):
    value: int
    label: str


class ParameterDescriptorResponse(StrictModel):
    key: str
    label: str
    description: str
    kind: Literal["number", "select"]
    default: int | float
    integer: bool
    min: int | float | None
    max: int | float | None
    step: int | float | None
    options: list[ParameterOptionResponse]


class AlgorithmDescriptorResponse(StrictModel):
    id: str
    tool_id: ToolId
    name: str
    description: str
    implementation_status: Literal["not_implemented", "implemented"]
    params: list[ParameterDescriptorResponse]


class CatalogResponse(StrictModel):
    items: list[AlgorithmDescriptorResponse]


class UploadResponse(StrictModel):
    image_id: UUID4
    filename: str
    content_type: Literal["image/jpeg", "image/png"]
    size_bytes: int
    width: int
    height: int
    url: str


NumericParameter = StrictInt | StrictFloat


class ProcessingStep(StrictModel):
    algorithm: StrictStr
    params: dict[StrictStr, NumericParameter]

    @model_validator(mode="after")
    def validate_params(self) -> "ProcessingStep":
        try:
            normalized = validate_and_fill_params(self.algorithm, self.params)
        except CatalogValidationError as exc:
            raise ValueError("invalid algorithm parameters") from exc
        self.params = normalized
        return self


def _validate_steps(steps: list[ProcessingStep]) -> list[ProcessingStep]:
    tools: set[str] = set()
    for index, step in enumerate(steps):
        algorithm = ALGORITHM_BY_ID[step.algorithm]
        if algorithm.tool_id in tools:
            raise ValueError("only one step per tool is allowed")
        tools.add(algorithm.tool_id)
        if algorithm.tool_id == "upscale" and index != len(steps) - 1:
            raise ValueError("upscale must be the final step")
    return steps


class ProcessRequest(StrictModel):
    image_id: UUID4
    steps: Annotated[list[ProcessingStep], Field(min_length=1, max_length=8)]

    @field_validator("steps")
    @classmethod
    def validate_step_order_and_exclusivity(
        cls, steps: list[ProcessingStep]
    ) -> list[ProcessingStep]:
        return _validate_steps(steps)


class AdviseRequest(StrictModel):
    image_id: UUID4
    prompt: StrictStr
    steps: Annotated[list[ProcessingStep], Field(max_length=8)]
    current_result_id: UUID4 | None = None

    @field_validator("prompt")
    @classmethod
    def trim_prompt(cls, prompt: str) -> str:
        trimmed = prompt.strip()
        if not 1 <= len(trimmed) <= 2000:
            raise ValueError("prompt length must be between 1 and 2000")
        return trimmed

    @field_validator("steps")
    @classmethod
    def validate_step_order_and_exclusivity(
        cls, steps: list[ProcessingStep]
    ) -> list[ProcessingStep]:
        return _validate_steps(steps)


class NotImplementedResponse(StrictModel):
    error: ErrorInfo


class ProcessResultResponse(StrictModel):
    """Metadata for an encoded and persisted processing result."""

    result_id: UUID4
    image_id: UUID4
    filename: str
    content_type: Literal["image/jpeg", "image/png"]
    size_bytes: int
    width: int
    height: int
    url: str
