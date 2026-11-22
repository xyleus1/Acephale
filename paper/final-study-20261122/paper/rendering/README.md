# Rebuild a separate paper PDF

Use Python 3.12, the package versions in requirements.lock, and the DejaVu fonts available under /usr/share/fonts/truetype/dejavu on the original Linux rendering host. From the package root, choose two new output directories:

    python paper/rendering/assemble.py --source paper --output scratch-assembly
    python paper/rendering/render.py --source scratch-assembly --output scratch-render

assemble.py copies the supplied text and figures and builds formal references from references.bib. render.py renders the manuscript, related work, references and methods appendix. The retained analysis plan remains a separate source supplement. native_section.py formats existing native-report fields; it does not define or recompute statistical estimators.

The delivered acephale-study.pdf remains the exact reviewed artifact. A new rendering may differ in timestamp metadata or environment-dependent layout; no byte-identity guarantee is made for a rebuild. No renderer, figure script or model was invoked during final curation. A separate public-row arithmetic parity check is documented in the package provenance.
