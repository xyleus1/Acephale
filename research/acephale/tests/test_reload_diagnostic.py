import ast
import inspect
import json
from types import SimpleNamespace

import pytest

from acephale import reload_diagnostic as diagnostic
from acephale.training_data import file_hash, file_inventory, hashed


def checkpoint(tmp_path):
    run = tmp_path / "run"
    (run / "adapter").mkdir(parents=True)
    (run / "adapter" / "adapter_model.safetensors").write_bytes(b"retained weights")
    (run / "reload-probe.pt").write_bytes(b"retained reference")
    spec = hashed({"seed": 17})
    receipt = hashed({"status": "completed", "steps": 204, "specificationHash": spec["contentHash"],
                      "frozenBeforeHash": "base", "frozenAfterHash": "base",
                      "adapterBeforeHash": "before", "adapterAfterHash": "after",
                      "probeHash": file_hash(run / "reload-probe.pt"),
                      "adapterFiles": file_inventory(run / "adapter")})
    (run / "training-specification.json").write_text(json.dumps(spec))
    (run / "receipt.json").write_text(json.dumps(receipt))
    return run, spec, receipt


def test_retained_checkpoint_is_only_read(tmp_path):
    run, spec, receipt = checkpoint(tmp_path)
    before = file_inventory(run)
    assert diagnostic.inputs(run, tmp_path / "new") == (spec, receipt)
    assert file_inventory(run) == before
    assert not (tmp_path / "new").exists()


@pytest.mark.parametrize("destination", ["existing", "nested"])
def test_never_overwrites_or_writes_into_original(tmp_path, destination):
    run, _, _ = checkpoint(tmp_path)
    output = run / "diagnostic" if destination == "nested" else tmp_path
    with pytest.raises(ValueError, match="new output outside"):
        diagnostic.inputs(run, output)


@pytest.mark.parametrize("field,value", [("steps", 203), ("status", "failed"),
    ("frozenAfterHash", "changed"), ("adapterAfterHash", "before"), ("specificationHash", "wrong")])
def test_incomplete_or_mismatched_training_is_rejected(tmp_path, field, value):
    run, _, receipt = checkpoint(tmp_path)
    receipt.pop("contentHash")
    receipt[field] = value
    (run / "receipt.json").write_text(json.dumps(hashed(receipt)))
    with pytest.raises(ValueError, match="Exact completed checkpoint"):
        diagnostic.inputs(run, tmp_path / "new")


@pytest.mark.parametrize("file", ["adapter/adapter_model.safetensors", "reload-probe.pt"])
def test_mutated_original_bytes_rejected(tmp_path, file):
    run, _, _ = checkpoint(tmp_path)
    (run / file).write_bytes(b"changed")
    with pytest.raises(ValueError, match="Exact completed checkpoint"):
        diagnostic.inputs(run, tmp_path / "new")


def test_temporary_backend_flag_restores_after_failure():
    flags = SimpleNamespace(allow_tf32=False)
    with pytest.raises(RuntimeError):
        with diagnostic.temporary_flag(flags, "allow_tf32", True):
            assert flags.allow_tf32 is True
            raise RuntimeError("forward failed")
    assert flags.allow_tf32 is False


def test_autotune_observation_is_read_only_and_handles_wrappers():
    config = SimpleNamespace(kwargs={"BK": 32}, num_warps=2, num_stages=3)
    cache = {(16, 128): config}
    kernel = SimpleNamespace(cache=cache, configs=[config], keys=["H", "K"], fn=None)
    wrapper = SimpleNamespace(fn=kernel)
    module = SimpleNamespace(kernel=wrapper, imported_alias=kernel)
    rows = diagnostic.kernel_observation([("fla.test", module), ("unrelated", module)])
    assert len(rows) == 1
    assert rows[0]["selected"] == [{"key": "(16, 128)", "kwargs": {"BK": 32}, "numWarps": 2, "numStages": 3}]
    assert kernel.cache is cache and cache[(16, 128)] is config


def test_diagnostic_has_no_optimizer_or_training_entry():
    source = inspect.getsource(diagnostic)
    tree = ast.parse(source)
    calls = {node.func.attr for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)}
    assert not calls & {"train", "backward", "step", "save_pretrained"}
    assert "action=\"diagnostic\"" in source
    assert "isExportAcceptance\": False" in source


def test_comparison_uses_original_full_vocabulary_gate():
    torch = pytest.importorskip("torch")
    reference = torch.tensor([[0., 1., -2.]])
    result = diagnostic.compare(reference.clone(), reference)
    assert result["exact"] and result["passesOriginalGate"] and result["elements"] == 3
    changed = reference.clone()
    changed[0, 0] = .031
    result = diagnostic.compare(changed, reference)
    assert result["mismatches"] == 1 and not result["passesOriginalGate"]
    assert result["atol"] == .03 and result["rtol"] == .02
