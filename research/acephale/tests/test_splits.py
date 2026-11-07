import pytest

from acephale.fixtures import demo_corpus
from acephale.splits import make_splits


def test_grouped_split_is_stable_and_keeps_trials_and_families_together():
    corpus = demo_corpus(groups=10)
    split = make_splits(corpus)
    assert split == make_splits(list(reversed(corpus)))
    assert set(split.assignments.values()) == {"train", "development", "test"}
    for group in {t.group_id for t in corpus}:
        assert len({split.assignments[t.trajectory_id] for t in corpus if t.group_id == group}) == 1


def test_split_rejects_changed_corpus_and_cross_split_family():
    corpus = demo_corpus(groups=5, trials=1)
    split = make_splits(corpus, expected_trials=1)
    with pytest.raises(ValueError, match="Corpus"):
        split.verify(corpus[:-1])
    assignments = dict(split.assignments)
    first = corpus[0].trajectory_id
    assignments[first] = "test" if assignments[first] != "test" else "train"
    with pytest.raises(ValueError, match="boundaries"):
        split.model_copy(update={"assignments": assignments}).verify(corpus)
