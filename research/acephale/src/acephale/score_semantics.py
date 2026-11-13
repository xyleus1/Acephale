"""Versioned score interpretation; historical artifacts retain their declared labels."""

from typing import Any

NEXT_BATCH_MEMBERSHIP = "next_batch_invocation_membership"
LEGACY_NEXT_BATCH_HIT = "independent_next_batch_hit"
CALIBRATED_MEMBERSHIP = "empirical_next_batch_membership"
RAW_SCORE_SEMANTICS = {
    "rank_binary_v1": "autoregressive_binary_conditional",
    "rank_marginals_v2": "model_reported_marginal",
}


def replay_score_semantics(manifest: dict[str, Any]) -> dict[str, Any]:
    """Validate the declared version without upgrading old artifact metadata."""
    version, semantics = manifest.get("version"), manifest.get("probabilitySemantics")
    if version == 2 and semantics == LEGACY_NEXT_BATCH_HIT and "rawScoreSemantics" not in manifest:
        return {"version": 2, "probabilitySemantics": LEGACY_NEXT_BATCH_HIT}
    raw = RAW_SCORE_SEMANTICS.get(manifest.get("predictionProtocol"))
    if version != 3 or semantics != NEXT_BATCH_MEMBERSHIP or raw is None or manifest.get("rawScoreSemantics") != raw:
        raise ValueError("Replay score semantics differ from the declared prediction protocol")
    return {"version": 3, "probabilitySemantics": NEXT_BATCH_MEMBERSHIP, "rawScoreSemantics": raw}
