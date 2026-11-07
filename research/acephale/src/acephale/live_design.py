"""Pre-execution paired cohort design. No failed task replacement or optional stopping."""
import math
import random
from dataclasses import asdict, dataclass

ARMS = ("base", "neutral_memory_prefetch", "acephale")
MODELS = {"actor": "Qwen/Qwen3.5-9B", "goal": "Qwen/Qwen3.5-0.8B", "candidate": "Qwen/Qwen3.5-0.8B", "teacher": "gpt-5.4-2026-03-05", "user": "gpt-4.1-mini-2025-04-14", "embedding": "text-embedding-3-small"}


@dataclass(frozen=True)
class Trial:
    family: str
    variant: int
    trial: int
    seed: int
    arm: str
    reserved_usd: float


def freeze_heldout(families: list[str], development_costs: list[float], censored: bool, seed: int, *, remaining_usd: float = 240):
    if not development_costs or any(not math.isfinite(c) or c < 0 for c in development_costs):
        raise ValueError("Completed development costs required")
    allowance = math.ceil(4 * max(1.25, 2.5 if censored else 0, 1.25 * max(development_costs))) / 4
    if not math.isfinite(remaining_usd) or remaining_usd < 0 or remaining_usd > 240:
        raise ValueError("Invalid remaining heldout allocation")
    count = min(16, 2 * math.floor(remaining_usd / (24 * allowance)))
    retail = sorted(f for f in families if f.startswith("retail:"))
    airline = sorted(f for f in families if f.startswith("airline:"))
    if len(set(families)) != len(families) or len(retail) < count // 2 or len(airline) < count // 2:
        raise ValueError("Insufficient unique balanced held-out families")
    selected = retail[:count // 2] + airline[:count // 2]
    rng = random.Random(seed)
    trials = []
    for family in selected:
        for variant in range(2):
            for trial in range(2):
                arms = list(ARMS)
                rng.shuffle(arms)
                trial_seed = rng.randrange(2**31)
                trials.extend(Trial(family, variant, trial, trial_seed, arm, allowance) for arm in arms)
    # The whole paired grid is reserved before any trial is dispatched.
    return {"label": "custom tau-compatible pilot", "models": MODELS, "allowance_usd": allowance, "families": selected, "reserved_usd": sum(t.reserved_usd for t in trials), "trials": [asdict(t) for t in trials]}


def validate_completed_grid(design, outcomes):
    expected = {(t["family"], t["variant"], t["trial"], t["arm"]) for t in design["trials"]}
    actual = [(r["family"], r["variant"], r["trial"], r["arm"]) for r in outcomes]
    if len(set(actual)) != len(actual) or set(actual) != expected:
        raise ValueError("Every reserved trial must have one outcome, including budget terminations")
    if any(r["budget_terminated"] and r["success"] for r in outcomes):
        raise ValueError("Budget terminations are failures")
