# Acephale V2: goal-conditioned speculative reads under exact-source constraints

23 November 2026 Â· Working paper

[Paper PDF (v0.2.0)](https://github.com/xyleus1/Acephale/releases/download/v0.2.0/acephale-paper.pdf) Â· [Editable source](https://github.com/xyleus1/Acephale/releases/download/v0.2.0/acephale-source.zip) Â· [Saved aggregate data](https://github.com/xyleus1/Acephale/releases/download/v0.2.0/acephale-data.zip) Â· [Figure exports](https://github.com/xyleus1/Acephale/releases/download/v0.2.0/acephale-figures.zip)

The fixed-actor research study retained 160 development trials. None of the three speculative policies produced an actor-consumed prefetch. Calibration exact-read coverage was 0/86 eligible checkpoints, including 0/46 visit checkpoints. The failed development gate prevented the conditional 400-trial heldout stage and its quality evaluation. Faster failed exits are not successful-task speedups.

The separate native-prefix experiment retained 136 development prefixes: 52 eligible reads and 28 covered windows. The original decoder fit 68 prefixes, including 24 empty windows and 44 generation cases; 68 remained unavailable. Both neutral-only head recipes completed training. Their exploratory, development-selected comparisons do not establish live latency or task-quality improvement. Checkpoint29 research replay is checkpoint/runtime sensitivity, not an isolated training-seed effect. The original 132-trial custom tau-compatible pilot remains a separate negative result.

## Build the PDF

Install Python 3.10+ and a TeX distribution providing pdflatex and bibtex with geometry, amsmath, amssymb, graphicx, booktabs, array, xcolor, longtable, calc, etoolbox, natbib, caption and hyperref. From the repository or extracted source root:

~~~bash
python -m pip install -r paper/requirements-render.txt
python paper/verify_saved.py
python paper/build.py --output acephale-paper.pdf
~~~

The build redraws the two figures from saved CSV cells and compiles the editable TeX. It does not rerun a model, benchmark, bootstrap, calibration fit, or statistical estimator. Intermediate files stay in paper/build/. The committed manuscript.tex is the PDF source; manuscript.md is its readable content companion. Pandoc 3.1.3 performed the initial Markdown-to-TeX conversion; Pandoc is not required to compile the bundled TeX.

## Saved values and figures

The tables directory contains byte-identical copies of the final study's nine numerical CSVs. results.json contains an aggregate-only projection of saved reports, including full native ranking estimates and intervals. figure-data.json binds the CSV hashes and rows. verify_saved.py checks the published file digests and CSV-to-figure-data identity.

~~~bash
python paper/plot_figures.py --source paper
~~~

Each figure has vector PDF, editable SVG, and 300-dpi PNG versions. The style follows Scalar-Pi v0.1.7: Computer Modern paper text, standard article layout, booktabs tables, and DejaVu Sans figures in blue, orange and grey. [Layout reference](https://github.com/xyleus1/scalar-pi/tree/8edc6de2c4806d90895d034291a6f280d68126b7/paper). This is a presentation adaptation, not a scientific comparison with Scalar-Pi.

## Provenance and limits

reproducibility/provenance.json identifies the immutable source paper, exact upstream pins, retained training recipes, and presentation-only changes. Researchy Questions supplied collection and development prompts. DeepResearch Bench supplied the conditional heldout/evaluator design, which was not executed after the failed gate.

The public data are explicit aggregate projections with new checksums. Outcomes, denominators, unavailable cases and uncertainty are retained. Private machine paths, resource identities, credentials, accounting ledgers, raw transcripts and provider response bodies are excluded. Original artifacts remain unchanged. This package reproduces presentation and verifies copied values; it is not a complete raw-trial re-estimation package.

No author names or new license terms are assigned by this presentation release. Existing repository and third-party terms remain applicable.
