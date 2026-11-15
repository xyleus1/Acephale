import ast
import inspect
from types import SimpleNamespace

import pytest

from acephale import reload_warmup_diagnostic as diagnostic


@pytest.mark.parametrize("optimizer,scheduler", [(object(), None), (None, object()), (object(), object())])
def test_optimizer_or_scheduler_is_rejected(optimizer, scheduler):
    with pytest.raises(ValueError, match="never construct"):
        diagnostic.require_no_optimizer(SimpleNamespace(optimizer=optimizer, lr_scheduler=scheduler))


def test_no_optimizer_is_allowed():
    diagnostic.require_no_optimizer(SimpleNamespace(optimizer=None, lr_scheduler=None))


def test_only_fitting_inputs_and_forward_calls_are_used():
    source = inspect.getsource(diagnostic)
    tree = ast.parse(source)
    calls = {node.func.attr for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)}
    assert not calls & {"train", "backward", "step", "create_optimizer", "create_scheduler", "save_pretrained"}
    partitions = [node.args[1].value for node in ast.walk(tree)
                  if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                  and node.func.id == "load_partition"]
    assert partitions == ["weight_fit"]
    assert '"historicalBatchIdentityProven": False' in source
    assert '"isExportAcceptance": False' in source
