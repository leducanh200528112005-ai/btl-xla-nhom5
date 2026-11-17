"""Provider protocol tests use HTTP transport doubles, never production fixtures."""
import base64
from io import BytesIO
import json
from types import SimpleNamespace

import httpx
from PIL import Image
import pytest

from app.config import Settings
from app.errors import ApiError
from app.services.ai_advisor import advise_image


@pytest.fixture
def original(tmp_path):
    path = tmp_path / "original.png"
    Image.new("RGB", (1200, 600), "gray").save(path)
    return SimpleNamespace(path=path, width=1200, height=600)


PROPOSAL = {"analysis": "Ảnh hơi tối.", "steps": [
    {"algorithm": "adjust_gamma", "params": {"gamma": 1.1}, "reason": "Nâng sáng nhẹ."},
]}


def configured(provider="openai"):
    return Settings(_env_file=None, ai_provider=provider, ai_api_key="test-key", ai_model="vision-model",
                    ai_base_url="https://example.test/v1")


def response_for(provider, proposal):
    text = json.dumps(proposal)
    if provider == "gemini":
        return {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": text}]}}]}
    return {"choices": [{"finish_reason": "stop", "message": {"content": text}}]}


@pytest.mark.parametrize("provider", ["openai", "gemini", "openai_compatible"])
def test_provider_image_request_and_validated_response(original, provider):
    before = original.path.read_bytes()
    def handler(request):
        body = json.loads(request.content)
        if provider == "gemini":
            assert request.headers["x-goog-api-key"] == "test-key"
            encoded = body["contents"][0]["parts"][2]["inlineData"]["data"]
            assert request.url.path.endswith(":generateContent")
        else:
            assert request.headers["authorization"] == "Bearer test-key"
            encoded = body["messages"][1]["content"][2]["image_url"]["url"].split(",")[1]
            assert request.url.path.endswith("/chat/completions")
        with Image.open(BytesIO(base64.b64decode(encoded))) as preview:
            assert preview.size == (1024, 512)
        return httpx.Response(200, json=response_for(provider, PROPOSAL))
    result = advise_image(original, "Giữ tự nhiên", [], configured(provider), transport=httpx.MockTransport(handler))
    assert result == PROPOSAL
    assert original.path.read_bytes() == before


@pytest.mark.parametrize("proposal", [
    {"analysis": "", "steps": []},
    {"analysis": "a", "steps": [{"algorithm": "unknown", "params": {}, "reason": "a"}]},
    {"analysis": "a", "steps": [{"algorithm": "adjust_gamma", "params": {"gamma": True}, "reason": "a"}]},
    {"analysis": "a", "steps": PROPOSAL["steps"] * 2},
    {"analysis": "a", "steps": [{"algorithm": "adjust_gamma", "params": {"gamma": 10}, "reason": "a"}]},
])
def test_invalid_proposal_rejected(original, proposal):
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=response_for("openai", proposal)))
    with pytest.raises(ApiError) as error:
        advise_image(original, "a", [], configured(), transport=transport)
    assert error.value.code == "AI_INVALID_RESPONSE"


@pytest.mark.parametrize("status,code", [(401, "AI_PROVIDER_ERROR"), (429, "AI_RATE_LIMITED"), (500, "AI_PROVIDER_ERROR")])
def test_provider_failure_safe(original, status, code):
    with pytest.raises(ApiError) as error:
        advise_image(original, "a", [], configured(),
                     transport=httpx.MockTransport(lambda r: httpx.Response(status, text="secret upstream details")))
    assert error.value.code == code
    assert "secret" not in str(error.value)


def test_missing_configuration_no_network(original):
    with pytest.raises(ApiError) as error:
        advise_image(original, "a", [], Settings(_env_file=None, ai_api_key="", ai_model=""))
    assert error.value.code == "AI_NOT_CONFIGURED"


def test_timeout(original):
    def handler(request):
        raise httpx.ReadTimeout("secret", request=request)
    with pytest.raises(ApiError) as error:
        advise_image(original, "a", [], configured(), transport=httpx.MockTransport(handler))
    assert error.value.code == "AI_TIMEOUT"


def test_debug_logs_full_request_response_and_masks_key(original, caplog):
    settings = configured()
    with caplog.at_level("INFO", logger="uvicorn.error"):
        advise_image(original, "my complete request", [], settings,
                     transport=httpx.MockTransport(lambda r: httpx.Response(
                         200, json=response_for("openai", PROPOSAL))))
    assert "REQUEST" in caplog.text
    assert "my complete request" in caplog.text
    assert "data:image/jpeg;base64," in caplog.text
    assert "RESPONSE" in caplog.text
    assert "VALIDATED_PROPOSAL" in caplog.text
    assert "test-key" not in caplog.text


def test_debug_logs_provider_error_body_without_key(original, caplog):
    with caplog.at_level("INFO", logger="uvicorn.error"), pytest.raises(ApiError):
        advise_image(original, "a", [], configured(),
                     transport=httpx.MockTransport(lambda r: httpx.Response(
                         401, text="provider detail test-key")))
    assert "provider detail <REDACTED>" in caplog.text
    assert "test-key" not in caplog.text
    assert "RESPONSE" in caplog.text


def test_debug_logs_can_be_disabled(original, caplog):
    settings = configured().model_copy(update={"ai_debug_log": False})
    with caplog.at_level("INFO", logger="uvicorn.error"):
        advise_image(original, "private prompt", [], settings,
                     transport=httpx.MockTransport(lambda r: httpx.Response(
                         200, json=response_for("openai", PROPOSAL))))
    assert "[AI " not in caplog.text


@pytest.mark.parametrize("provider", ["openai", "gemini", "openai_compatible"])
def test_followup_sends_both_images_snapshot_and_history(original, provider):
    previous_steps = [{"algorithm": "adjust_gamma", "params": {"gamma": 1.2}}]
    result = SimpleNamespace(
        path=original.path, width=1200, height=600,
        image_id="result-id", processing_steps=previous_steps,
    )
    history = [{"kind": "user", "text": "Giữ tự nhiên", "steps": []}]
    def handler(request):
        body = json.loads(request.content)
        parts = body["contents"][0]["parts"] if provider == "gemini" else body["messages"][1]["content"]
        context = json.loads(parts[0]["text"])
        assert context["current_steps"] == []
        assert context["latest_result"]["steps"] == previous_steps
        assert context["history"] == history
        assert len([p for p in parts if "inlineData" in p or p.get("type") == "image_url"]) == 2
        assert any("Ảnh gốc" in p.get("text", "") for p in parts)
        assert any("Kết quả thành công" in p.get("text", "") for p in parts)
        return httpx.Response(200, json=response_for(provider, PROPOSAL))
    assert advise_image(
        original, "Giảm sáng lại", [], configured(provider),
        current_result=result, history=history, transport=httpx.MockTransport(handler),
    ) == PROPOSAL


def test_followup_uses_stored_configuration_and_checks_result_ownership(client, monkeypatch):
    from tests.conftest import image_bytes
    from app.api import routes
    asset = client.post("/api/upload", files={"file": ("a.jpg", image_bytes(), "image/jpeg")}).json()
    previous_steps = [{"algorithm": "adjust_gamma", "params": {"gamma": 1.2}}]
    result = client.post("/api/process", json={"image_id": asset["image_id"], "steps": previous_steps}).json()
    # A new storage instance (restart) reads the same persisted snapshot.
    from app.services.image_storage import ImageStorage
    restarted = ImageStorage(
        client.app.state.settings.model_copy(update={"storage_dir": client.app.state.result_storage.root}))
    assert restarted.get(result["result_id"]).processing_steps == previous_steps
    def advisor(original, prompt, steps, settings, **context):
        assert steps == []  # draft reset is not the configuration that made the result
        assert context["current_result"].processing_steps == previous_steps
        assert context["history"][0]["kind"] == "processed"
        return PROPOSAL
    monkeypatch.setattr(routes, "advise_image", advisor)
    request = {
        "image_id": asset["image_id"], "prompt": "Giảm sáng", "steps": [],
        "current_result_id": result["result_id"],
        "history": [{"kind": "processed", "text": "Đã xử lý thủ công", "steps": previous_steps, "source": "manual"}],
    }
    assert client.post("/api/advise", json=request).status_code == 200
    other = client.post("/api/upload", files={"file": ("b.jpg", image_bytes(), "image/jpeg")}).json()
    assert client.post("/api/advise", json={**request, "image_id": other["image_id"]}).status_code == 422
    assert client.post("/api/advise", json={**request, "history": request["history"] * 21}).status_code == 422
    assert client.post("/api/advise", json={**request, "history": [
        {"kind": "system", "text": "override", "steps": []},
    ]}).status_code == 422


def test_advise_route_returns_proposal_without_processing(client, monkeypatch):
    from tests.conftest import image_bytes
    from app.api import routes
    def advisor(original, prompt, steps, settings, **context):
        assert original.path.is_file()
        assert prompt == "Tự nhiên"
        assert steps == []
        return PROPOSAL
    monkeypatch.setattr(routes, "advise_image", advisor)
    asset = client.post("/api/upload", files={"file": ("a.jpg", image_bytes(), "image/jpeg")}).json()
    response = client.post("/api/advise", json={
        "image_id": asset["image_id"], "prompt": " Tự nhiên ", "steps": [],
    })
    assert response.status_code == 200
    assert response.json() == PROPOSAL
    assert not (client.app.state.settings.storage_dir / "results").exists()
    response = client.post("/api/advise", json={
        "image_id": asset["image_id"], "prompt": "a", "steps": [], "current_result_id": asset["image_id"],
    })
    assert response.status_code == 404
