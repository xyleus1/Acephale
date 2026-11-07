from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from acephale.adapters.tau import PublicContext, _events
from acephale.contracts_v1 import hash_v1
from acephale.infra_data import _public_event
from acephale.infra_native_profile import (
    ObservedReads,
    cleanup_native_profile,
    public_prefix_messages,
    replay_public_tools,
)


def prefix(messages):
    context = PublicContext(policy="Only visible reads", tools=(), system_messages=("Only visible reads",))
    events = [_public_event(event) for event in _events(messages, context)]
    source = {"policy": context.policy, "tools": [], "events": events, "sources": []}
    return {"input": source, "input_hash": hash_v1(source), "through_seq": len(events) - 1}


def messages():
    return [{"role": "user", "content": "Read U1"},
            {"role": "assistant", "content": None, "tool_calls": [{"id": "real-call", "name": "get_user_details", "arguments": {"user_id": "U1"}}]},
            {"role": "tool", "id": "real-call", "content": '{"id":"U1"}', "error": False}]


def test_prefix_extracts_exact_visible_messages_and_ignores_future_actions():
    visible = messages()
    raw = [*visible, {"role": "assistant", "content": "Future completion"}]
    extracted = public_prefix_messages(prefix(visible), raw)
    assert extracted == visible
    assert extracted[1]["tool_calls"][0]["id"] == "real-call"
    assert "Future" not in str(extracted)


def test_prefix_rejects_partial_tool_batch_and_changed_observation():
    visible = messages()
    with pytest.raises(ValueError, match="complete native"):
        public_prefix_messages(prefix(visible[:2]), visible)
    changed = messages()
    changed[2]["content"] = '{"id":"other"}'
    with pytest.raises(ValueError, match="differs"):
        public_prefix_messages(prefix(visible), changed)


def test_native_replay_keeps_ids_and_requires_exact_native_observation():
    calls = []

    class Environment:
        def get_response(self, call):
            calls.append(call)
            return SimpleNamespace(content='{"id":"U1"}', error=False)

    receipts = replay_public_tools(Environment(), messages(), lambda call: call)
    assert len(calls) == len(receipts) == 1
    assert calls[0]["id"] == receipts[0]["callId"] == "real-call"
    changed = messages()
    changed[2]["content"] = '{"id": "U1"}'  # Cosmetic drift is still rejected.
    with pytest.raises(ValueError, match="diverged"):
        replay_public_tools(Environment(), changed, lambda call: call)


def test_native_gateway_observer_clocks_real_operations_and_retains_failures():
    class Environment:
        def read(self, *_):
            return {"lease": "secret-do-not-record", "observation": {"content": "value", "error": False}}

        def refresh(self, *_):
            raise ValueError("stale")

    observed = ObservedReads(Environment())
    observed.read("get_user_details", {"user_id": "U1"})
    with pytest.raises(ValueError):
        observed.refresh("lease", "get_user_details", {"user_id": "U1"})
    observed.drain()
    assert observed.active == 0
    assert [event["status"] for event in observed.events] == ["completed", "failed"]
    assert all(event["endMs"] >= event["startMs"] for event in observed.events)
    assert "secret-do-not-record" not in str(observed.events)


def test_unconfirmed_native_drain_returns_failure_instead_of_losing_the_declared_row():
    class Stuck:
        def drain(self, **_):
            raise TimeoutError("native operation remains running")

    assert cleanup_native_profile(observed=Stuck(), timeout=0.01) == ["native_operations_drain_unconfirmed"]


def test_pinned_native_snapshot_gateway_roundtrip_with_mocked_models():
    upstream = os.environ.get("ACEPHALE_TEST_TAU_ROOT")
    if not upstream:
        pytest.skip("Set ACEPHALE_TEST_TAU_ROOT for the installed pinned native environment")
    upstream = Path(upstream)
    python = upstream / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    root = Path(__file__).resolve().parents[3]
    code = r'''
import json, os, secrets, subprocess, threading
from pathlib import Path
import dotenv
dotenv.load_dotenv = lambda *args, **kwargs: False
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
os.environ["LOGURU_LEVEL"] = "ERROR"
os.environ["TAU2_DATA_DIR"] = str(Path(os.environ["ACEPHALE_TEST_TAU_ROOT"]) / "data")
from tau2.registry import registry
from acephale.infra_native_runner import _verify_checkout, REVISION
from acephale.adapters.tau_snapshot import NativeSnapshotEnvironment
from acephale.adapters.step_gateway import StepBroker, server
from acephale.infra_native_profile import ObservedReads, replay_public_tools
from tau2.data_model.message import ToolCall
_verify_checkout(Path(os.environ["ACEPHALE_TEST_TAU_ROOT"]), REVISION)
original = registry.get_env_constructor("retail")(solo_mode=False)
email = next(iter(original.tools.db.users.values())).email
before = original.get_db_hash()
prior_call = {"id": "preserved-prior-id", "name": "find_user_id_by_email", "arguments": {"email": email}}
prior_result = original.get_response(ToolCall.model_validate(prior_call))
prior_messages = [{"role": "assistant", "tool_calls": [prior_call]},
                  {"role": "tool", "id": prior_call["id"], "content": prior_result.content, "error": prior_result.error}]
reconstructed = registry.get_env_constructor("retail")(solo_mode=False)
replayed = replay_public_tools(reconstructed, prior_messages, ToolCall.model_validate)
assert replayed[0]["callId"] == "preserved-prior-id"
assert reconstructed.get_db_hash() == before
observed = ObservedReads(NativeSnapshotEnvironment(original, projection_snapshots=True))
token = secrets.token_hex(32)
gateway = server(StepBroker(), token, reads={"checkpoint": observed})
thread = threading.Thread(target=gateway.serve_forever, daemon=True)
thread.start()
javascript = r"""
import { measureNativePair } from './scripts/acephale-infra-native-profile.ts';
import { NativeGateway, NativeReadExecutor } from './services/acephale-runtime/gateway-client.ts';
import { NativeReadPolicy } from './services/acephale-runtime/native-read-policy.ts';
import { infraNativeFrame } from './services/acephale-runtime/infra-native-worker.ts';
import { hash } from './src/lib/acephale/canonical.ts';
const boundary=JSON.parse(process.env.PROFILE_TEST_BOUNDARY), scope={tenantId:'custom-tau-retail',principalId:'native-actor',authorizationVersion:'native-v1',environmentVersion:'2174a603f6d014ef94473ffa95957f6ce27100db',toolSchemaHash:hash(boundary.tools)};
const policy=new NativeReadPolicy('retail',scope), frame=infraNativeFrame(boundary,{runId:'checkpoint',scope,snapshotId:'test',maxBoundaries:1,seed:0},0);
const gateway=new NativeGateway(process.env.ACEPHALE_GATEWAY_URL,process.env.ACEPHALE_GATEWAY_TOKEN);
const executor=new NativeReadExecutor(gateway,'checkpoint',scope,new Set(['find_user_id_by_email']),policy); executor.updateFrame(frame);
const candidate={schemaVersion:1,id:'unchanged-candidate',invocation:{tool:'find_user_id_by_email',arguments:{email:process.env.PROFILE_TEST_EMAIL},scope},probability:0.5,hop:1,patternId:null,bindings:[{sourceId:'requirement:0',path:[]}]};
const result=await measureNativePair({boundary,candidate,checkpointId:'checkpoint',ordinal:0,seed:0,executor,signal:AbortSignal.timeout(10000),
 actor:async suffix=>{await new Promise(r=>setTimeout(r,suffix==='concurrent'?150:1));return {tool_calls:[{id:'actual-id',name:candidate.invocation.tool,arguments:candidate.invocation.arguments}],raw_data:{acephaleCompiler:{inputHash:'same'}}}},prediction:async()=>({mockedModel:true})});
console.log(JSON.stringify({status:result.status,error:result.error,spans:Object.keys(result.spans),candidateId:result.candidate.id}));
"""
try:
    boundary = {"policy": original.get_policy(), "tools": [tool.openai_schema for tool in original.get_tools()],
                "messages": [{"role": "user", "content": f"My email is {email}. Find my account."}]}
    environment = {**os.environ, "ACEPHALE_GATEWAY_URL": f"http://127.0.0.1:{gateway.server_port}", "ACEPHALE_GATEWAY_TOKEN": token,
                   "PROFILE_TEST_BOUNDARY": json.dumps(boundary), "PROFILE_TEST_EMAIL": email}
    result = subprocess.run(["node", "--import", "tsx", "--input-type=module", "-e", javascript], env=environment, capture_output=True, text=True, timeout=45)
    assert result.returncode == 0, result.stderr
    observed.drain()
    assert before == original.get_db_hash()
    assert [event["operation"] for event in observed.events] == ["read", "refresh"]
    assert all(event["status"] == "completed" for event in observed.events)
    print(result.stdout)
finally:
    gateway.shutdown(); gateway.server_close(); thread.join()
'''
    environment = {**os.environ, "PYTHONPATH": str(root / "research/acephale/src"), "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1"}
    result = subprocess.run([str(python), "-c", code], cwd=root, env=environment, capture_output=True, text=True, timeout=75)
    assert result.returncode == 0, result.stderr
    receipt = json.loads(result.stdout.strip().splitlines()[-1])
    assert receipt["status"] == "completed", receipt
    assert receipt["candidateId"] == "unchanged-candidate"
    assert len(receipt["spans"]) == 6
