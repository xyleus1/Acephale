import io
import json
from pathlib import Path
from unittest.mock import Mock

import pytest

from goalspec.adapters.protocol import (
    NativeRunSpec,
    WorkerRequest,
    WorkerResponse,
    invoke_tau,
    serve,
    tau_worker_command,
)


def test_jsonl_correlation_and_stderr_separation():
    def handler(request):
        print("native benchmark progress")
        return {"seen": request.request_id}

    output, errors = io.StringIO(), io.StringIO()
    lines = "\n".join(
        WorkerRequest(request_id=name, operation="ping").model_dump_json()
        for name in ("one", "two", "one")
    )
    serve(handler, io.StringIO(lines), output, errors)
    responses = [
        WorkerResponse.model_validate_json(line) for line in output.getvalue().splitlines()
    ]
    assert [response.request_id for response in responses] == ["one", "two", "one"]
    assert responses[0].result == {"seen": "one"}
    assert responses[2].error.code == "ValueError"
    assert "native benchmark progress" in errors.getvalue()
    assert "native benchmark progress" not in output.getvalue()


def test_unknown_protocol_gets_correlated_error():
    output, errors = io.StringIO(), io.StringIO()
    serve(
        lambda _: {},
        io.StringIO(json.dumps({"protocol_version": 2, "request_id": "r", "operation": "ping"})),
        output,
        errors,
    )
    response = WorkerResponse.model_validate_json(output.getvalue())
    assert response.request_id == "r"
    assert response.error.code == "ValidationError"


def test_malformed_uncorrelated_input_stops_without_fabricating_id():
    output, errors = io.StringIO(), io.StringIO()
    handler = Mock()
    serve(handler, io.StringIO("not-json\n"), output, errors)
    assert not output.getvalue()
    assert "uncorrelated" in errors.getvalue()
    handler.assert_not_called()


def test_worker_command_uses_native_locked_environment_and_argv(tmp_path):
    command = tau_worker_command(tmp_path / "path with spaces", uv="uv")
    assert command[:3] == ["uv", "run", "--project"]
    assert command[3] == str((tmp_path / "path with spaces").resolve())
    assert "--frozen" in command
    assert command[-1].endswith("tau_worker.py")
    assert Path(command[-1]).is_absolute()


def test_native_config_requires_explicit_models_seeds_and_absolute_output(tmp_path):
    fields = dict(
        domain="retail",
        task_ids=("1",),
        seeds=(1, 2),
        actor_model="test/actor",
        user_model="test/user",
        output_dir=str(tmp_path),
    )
    assert NativeRunSpec(**fields).seeds == (1, 2)
    with pytest.raises(ValueError, match="distinct"):
        NativeRunSpec(**{**fields, "seeds": (1, 1)})
    with pytest.raises(ValueError, match="absolute"):
        NativeRunSpec(**{**fields, "output_dir": "relative"})
    with pytest.raises(ValueError, match="Ground-truth"):
        NativeRunSpec(**{**fields, "retrieval_config": "golden_retrieval"})
    with pytest.raises(ValueError):
        WorkerRequest(request_id="r", operation="run")


def test_client_validates_response_correlation(monkeypatch, tmp_path):
    captured = {}

    def run(argv, **kwargs):
        captured.update(argv=argv, **kwargs)
        return Mock(stdout=WorkerResponse(request_id="wrong", result={}).model_dump_json() + "\n")

    monkeypatch.setattr("goalspec.adapters.protocol.subprocess.run", run)
    with pytest.raises(ValueError, match="correlation"):
        invoke_tau(tmp_path, WorkerRequest(request_id="request", operation="ping"))
    assert captured["env"]["PYTHON_DOTENV_DISABLED"] == "1"
    assert "shell" not in captured


def test_context_only_banking_rejects_eager_embedding_initialization(tmp_path):
    fields = dict(
        domain="banking_knowledge",
        task_ids=("1",),
        seeds=(1,),
        actor_model="test/actor",
        user_model="test/user",
        output_dir=str(tmp_path),
    )
    for retrieval in (None, "alltools", "openai_embeddings"):
        payload = NativeRunSpec(**fields, retrieval_config=retrieval)
        with pytest.raises(ValueError, match="embedding API calls"):
            WorkerRequest(request_id="capture", operation="capture_context", payload=payload)
        assert WorkerRequest(request_id="run", operation="run", payload=payload)
    for retrieval in ("bm25", "bm25_grep", "grep_only"):
        assert WorkerRequest(
            request_id="capture",
            operation="capture_context",
            payload=NativeRunSpec(**fields, retrieval_config=retrieval),
        )
