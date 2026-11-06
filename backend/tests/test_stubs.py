# Xác nhận thuật toán/pipeline/AI chưa triển khai bằng NotImplementedError.
# Khi làm thật cần bổ sung kiểm thử chất lượng và sửa kỳ vọng stub có chủ đích;
# không xóa kiểm thử chỉ để che lỗi hoặc trả input nguyên trạng như kết quả.

"""Remaining member 2 and advisor interfaces stay explicit stubs.

Member 1 has existing implementation tests in test_denoise/brightness/contrast;
its modules are deliberately not registered in the member 3/4 pipeline yet.
"""

from uuid import uuid4

import pytest

from app.algorithms.scratches import detect_scratches, reduce_scratches
from app.algorithms.sharpen import sharpen_unsharp
from app.services.ai_advisor import advise_image


@pytest.mark.parametrize(
    ("function", "args"),
    [
        (sharpen_unsharp, (object(), {"amount": 0.8, "sigma": 1})),
        (detect_scratches, (object(), {"sensitivity": 0.5, "inpaint_radius": 3})),
        (reduce_scratches, (object(), {"sensitivity": 0.5, "inpaint_radius": 3})),
        (advise_image, (uuid4(), object(), "request", [], None)),
    ],
)
def test_processing_and_ai_interfaces_raise_not_implemented(function, args):
    with pytest.raises(NotImplementedError):
        function(*args)
