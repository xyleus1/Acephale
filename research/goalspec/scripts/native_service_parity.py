"""Native orchestration with the real Node service and deterministic fixture model."""
# ruff: noqa: E402
import json
import os
import secrets
import subprocess
import threading
from pathlib import Path

from native_snapshot_parity import (
    ROOT,
    EvaluationType,
    FixtureUser,
    NativeSnapshotEnvironment,
    Orchestrator,
    airline,
    airline_tasks,
    evaluate_simulation,
    orchestration,
    retail,
    retail_tasks,
)

from goalspec.adapters.step_gateway import StepBroker, server
from goalspec.adapters.tau_external_agent import ExternalGoalSpecAgent


def verify(factory, tasks, listing, output):
    direct = orchestration(factory, tasks, listing, False)
    environment = NativeSnapshotEnvironment(factory())
    broker = StepBroker()
    token = secrets.token_hex(32)
    gateway = server(broker, token, reads={"parity": environment})
    thread = threading.Thread(target=gateway.serve_forever, daemon=True)
    thread.start()
    actor = ExternalGoalSpecAgent(environment.get_tools(), environment.get_policy(), broker, "parity", environment)
    process = subprocess.Popen(["node", "--import", "tsx", "scripts/goalspec-service.ts", "scripts/goalspec-service-fixture.ts", str(output)], cwd=ROOT,
                               env={**os.environ, "GOALSPEC_GATEWAY_URL": f"http://127.0.0.1:{gateway.server_port}",
                                    "GOALSPEC_GATEWAY_TOKEN": token, "GOALSPEC_FIXTURE_TOOL": listing,
                                    "GOALSPEC_FIXTURE_TOOLS": json.dumps([tool.openai_schema for tool in actor.tools])})
    def monitor():
        if process.wait() != 0:
            broker.close()
    threading.Thread(target=monitor, daemon=True).start()
    try:
        task = tasks()[0]
        simulation = Orchestrator(domain=environment.domain_name, agent=actor, user=FixtureUser(),
                                  environment=environment, task=task, max_steps=10, seed=17).run()
        reward = evaluate_simulation(simulation, task, EvaluationType.ENV, False, environment.domain_name)
        actual = {"observations": [m.model_dump(exclude={"timestamp", "turn_idx"}) for m in simulation.messages if m.role == "tool"],
                  "state": environment.get_db_hash(), "termination": simulation.termination_reason.value, "reward": reward.reward}
        broker.finish("parity", timeout=20)
        assert process.wait(timeout=20) == 0
        assert actual == direct
        assert environment.promotion_events == [{"call_id": "native-real-call", "status": "consumed"}]
        assert not (output / "budget.jsonl.lock").exists()
        return {"domain": environment.domain_name, "passed": True, "native_consumptions": 1, "perRunDrainAcknowledged": True}
    finally:
        broker.close()
        gateway.shutdown()
        gateway.server_close()
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=10)


if __name__ == "__main__":
    import sys
    destination = Path(sys.argv[1]).resolve()
    destination.mkdir(exist_ok=False, parents=True)
    report = {"label": "native service parity with scripted model, not benchmark performance", "provider_calls": 0,
              "checks": [verify(retail, retail_tasks, "list_all_product_types", destination / "retail"),
                         verify(airline, airline_tasks, "list_all_airports", destination / "airline")]}
    (destination / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))
