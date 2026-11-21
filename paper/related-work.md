# Related work

PASTE predicts future tool invocations and overlaps their speculative execution with model generation while withholding results until confirmation. This motivates Acephale's overlap and exact-invocation design. Acephale does not claim to reproduce the full PASTE implementation or its reported performance. [Sui et al., version 3](https://arxiv.org/abs/2603.18897v3).

Speculate with Memory augments a speculator with transition statistics, episodic retrieval and recurring-error tracking. These motivate memory-supported prediction; Acephale separately studies source-grounded goal conditioning under its own frozen protocol. The prior paper's reported gains are not measurements of this system. [Li et al., version 1](https://arxiv.org/abs/2607.12236v1).

The native environment is pinned to tau2-bench commit 2174a603f6d014ef94473ffa95957f6ce27100db. Custom task composition and restricted coverage must be disclosed. This provenance alone does not establish official benchmark comparability. [Pinned upstream source](https://github.com/sierra-research/tau2-bench/tree/2174a603f6d014ef94473ffa95957f6ce27100db).

Titles, authors, versions and scope of the two papers were checked against primary arXiv records during preparation. No external numerical result is copied into the study's outcome tables.
