"""AI advisor remains outside the eight image-processing tools."""
from uuid import uuid4
import pytest
from app.services.ai_advisor import advise_image


def test_advisor_is_explicit_stub():
    with pytest.raises(NotImplementedError):
        advise_image(uuid4(), object(), "request", [], None)
