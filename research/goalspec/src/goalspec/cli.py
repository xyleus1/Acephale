"""CLI for the gated research pilot, not a production application runtime."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

import typer

from goalspec import __version__
from goalspec.experiment import fit, replay
from goalspec.fixtures import demo_corpus
from goalspec.gates import GateReport
from goalspec.goal_backends import BackendConfig
from goalspec.replay import decision_points
from goalspec.schemas import Trajectory
from goalspec.splits import SplitManifest, make_splits
from goalspec.storage import load_trajectories, write_json, write_trajectories

app = typer.Typer(no_args_is_help=True, pretty_exceptions_show_locals=False,
                  help="GoalSpec: reproducible endpoint-conditioned prediction research.")


@app.command()
def validate(corpus: Path) -> None:
    """Validate a complete trajectory corpus and causal tool visibility."""
    trajectories = load_trajectories(corpus)
    count = sum(len(list(decision_points(t))) for t in trajectories)
    typer.echo(json.dumps({"trajectories": len(trajectories), "decision_batches": count, "valid": True}))


@app.command("split")
def split_command(corpus: Path, output: Path, seed: int = 42, expected_trials: int = 4) -> None:
    """Freeze grouped train/development/test partitions before learning."""
    manifest = make_splits(load_trajectories(corpus), seed, expected_trials)
    write_json(output, manifest)
    typer.echo(str(output.resolve()))


@app.command("fit")
def fit_command(corpus: Path, split: Path, output: Path, max_context: int = 3, min_support: int = 2) -> None:
    """Discover normalized endpoint clusters and mine patterns from training only."""
    manifest = fit(load_trajectories(corpus), _split(split), output, max_context=max_context, min_support=min_support)
    typer.echo(json.dumps({"training_trajectories": len(manifest.training_trajectory_ids), "artifacts": str(output.resolve())}))


@app.command("replay")
def replay_command(corpus: Path, split: Path, artifacts: Path, output: Path,
                   partition: str = "development", bootstrap_samples: int = 2000,
                   goal_config: Annotated[Path | None, typer.Option(help="Frozen lexical, LLM or embedding backend configuration.")] = None) -> None:
    """Score the frozen actor corpus. Test results cannot open the scheduler gate."""
    if partition not in {"development", "test"}:
        raise typer.BadParameter("partition must be development or test")
    result = replay(load_trajectories(corpus), _split(split), artifacts, output,
                    partition=partition, bootstrap_samples=bootstrap_samples,
                    goal_config=BackendConfig.model_validate_json(goal_config.read_text(encoding="utf-8")) if goal_config else None)
    typer.echo(json.dumps({"gate_status": result["gate_status"], "scheduler_allowed": result["scheduler_allowed"], "summary": str((output / "summary.json").resolve())}))


@app.command()
def demo(output: Annotated[Path, typer.Option(help="New output directory; synthetic data never passes research gates.")] = Path("runs/demo"),
         groups: int = 30, bootstrap_samples: int = 500) -> None:
    """Exercise collection, splitting, mining, replay and gates without any API calls."""
    if output.exists():
        raise typer.BadParameter("Use a new demo directory to preserve prior runs")
    if groups < 10:
        raise typer.BadParameter("Use at least ten groups for paired bootstrap diagnostics")
    corpus = demo_corpus(groups=groups)
    write_trajectories(output / "trajectories.jsonl", corpus)
    split = make_splits(corpus)
    write_json(output / "split.json", split)
    fit(corpus, split, output / "artifacts")
    result = replay(corpus, split, output / "artifacts", output / "replay", bootstrap_samples=bootstrap_samples)
    if result["scheduler_allowed"]:
        raise RuntimeError("Synthetic evidence incorrectly opened the scientific gate")
    typer.echo(json.dumps({"synthetic": True, "trajectories": len(corpus), "gate_status": result["gate_status"], "scheduler_allowed": False, "summary": str((output / "replay/summary.json").resolve())}))


@app.command("import-tau")
def import_tau_command(results: Path, contexts: Path, output: Path,
                       labels: Annotated[Path | None, typer.Option(help="Offline endpoint and task-family labels, never predictor context.")] = None) -> None:
    """Import pinned native tau3 runs using a pre-execution public-context sidecar."""
    from goalspec.adapters.tau import import_tau

    corpus = import_tau(results, contexts_path=contexts, labels_path=labels)
    for trajectory in corpus:
        list(decision_points(trajectory))
    write_trajectories(output, corpus)
    typer.echo(json.dumps({"trajectories": len(corpus), "output": str(output.resolve())}))


@app.command("merge")
def merge_command(output: Path, corpora: list[Path]) -> None:
    """Combine separately captured domains; duplicate trajectory IDs are rejected."""
    trajectories = [trajectory for path in corpora for trajectory in load_trajectories(path)]
    if len({t.trajectory_id for t in trajectories}) != len(trajectories):
        raise typer.BadParameter("Corpora contain duplicate trajectory IDs")
    write_trajectories(output, trajectories)
    typer.echo(json.dumps({"trajectories": len(trajectories), "output": str(output.resolve())}))


@app.command("tau-spec")
def tau_spec_command(output: Path, run_output: Path,
                     actor_model: Annotated[str, typer.Option()],
                     user_model: Annotated[str, typer.Option()], domain: str = "retail",
                     task_id: Annotated[list[str] | None, typer.Option(help="Repeat for every task in the declared cohort.")] = None,
                     seed: Annotated[list[int] | None, typer.Option(help="Repeat for independent trials.")] = None,
                     retrieval_config: str | None = None) -> None:
    """Write an explicit native run specification with portable absolute output paths."""
    from goalspec.adapters.protocol import NativeRunSpec

    spec = NativeRunSpec(domain=domain, task_ids=tuple(task_id or ["0"]), seeds=tuple(seed or [0, 1, 2, 3]),
                         actor_model=actor_model, user_model=user_model,
                         output_dir=str(run_output.resolve()), retrieval_config=retrieval_config)
    write_json(output, spec)
    typer.echo(str(output.resolve()))


@app.command("tau-run")
def tau_run_command(spec: Path, benchmark_dir: Path, contexts_only: bool = False,
                    uv: Annotated[str | None, typer.Option(help="uv executable path, when uv is not on PATH.")] = None) -> None:
    """Use the isolated pinned native worker; contexts-only performs no model calls."""
    from goalspec.adapters.protocol import NativeRunSpec, WorkerRequest, invoke_tau

    run_spec = NativeRunSpec.model_validate_json(spec.read_text(encoding="utf-8"))
    request = WorkerRequest(request_id="goalspec-native-capture", operation="capture_context" if contexts_only else "run", payload=run_spec)
    response = invoke_tau(benchmark_dir, request, uv=uv)
    typer.echo(response.model_dump_json())


@app.command("gate-status")
def gate_status(path: Path) -> None:
    """Verify a gate report; exit 2 for pending evidence, 3 for a failed hypothesis."""
    report = GateReport.model_validate_json(path.read_text(encoding="utf-8"))
    report.verify()
    typer.echo(json.dumps({"status": report.status, "scheduler_allowed": report.scheduler_allowed,
                           "experiment_a": report.experiment_a.reasons, "experiment_b": report.experiment_b.reasons}))
    if report.status != "passed":
        raise typer.Exit(code=2 if report.status == "insufficient_evidence" else 3)


@app.command("classify-initial")
def classify_initial(corpus: Path, split: Path, artifacts: Path, output: Path,
                     model: Annotated[str, typer.Option()], partition: str = "development",
                     batch_size: int = 1, timeout: float = 240, workers: int = 4) -> None:
    """Capture public-input-only goal predictions using the installed Codex CLI."""
    from goalspec.cli_classifier import capture_initial_goals

    if partition not in {"development", "test"}:
        raise typer.BadParameter("partition must be development or test")
    config = capture_initial_goals(load_trajectories(corpus), _split(split), artifacts,
                                   output, model=model, partition=partition,
                                   batch_size=batch_size, timeout=timeout, workers=workers)
    typer.echo(str(config.resolve()))


@app.command("report")
def report_command(replay_dir: Path, output: Path, plots: bool = False) -> None:
    """Write verified per-domain benchmarks, paired intervals and research conclusions."""
    from goalspec.reporting import generate_report

    path = generate_report(replay_dir, output, plots=plots)
    typer.echo(str(path.resolve()))


@app.command("schema")
def schema_command(output: Path) -> None:
    """Export the versioned trajectory JSON Schema for adapter implementers."""
    write_json(output, Trajectory.model_json_schema())
    typer.echo(str(output.resolve()))


@app.command()
def version() -> None:
    typer.echo(__version__)


def _split(path: Path) -> SplitManifest:
    return SplitManifest.model_validate_json(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    app()
