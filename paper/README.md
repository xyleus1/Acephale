# Current results paper: incomplete frozen study

This paper reports the dated disposition observed on 22 November 2026 at 06:26 UTC: three accepted components, one failed opportunity component, four derived blocked descendants and four pending independent components. It is not a completed benchmark or an official tau task-success evaluation. Read manuscript.md and results-status.md.

The accepted seed17 estimates and confidence intervals, source reports, frozen scientific rules and both figures are preserved. The opportunity profile has eight completed and twelve retained profile failures among twenty rows, below the original minimum of ten completed measurements. Forty earlier pre-model error records remain separate. Numerical validation diagnostics are reported separately; none supplies a benchmark gain or scientific acceptance.

## Reproduce this presentation

From the repository root, the PDF commands use the versions in paper/rendering/requirements.lock. The optional plotting commands also require Matplotlib (the retained figure records version 3.11.2); plotting dependencies are not included in the PDF-only lock. The copy-only disposition exporter uses the Python standard library:

    python paper/disposition/export_snapshot.py --output build/paper04-recorded-values
    python paper/plot_retained.py
    python paper/plot_profile_outcome.py
    python paper/rendering/assemble.py --source paper --output build/paper04-assembled
    python paper/rendering/render.py --source build/paper04-assembled --output build/paper04-rendered

Output directories must be fresh for assembly and the recorded-value export. Plotting reads the already accepted reports; it does not rerun a bootstrap or score pending data. Existing figure bytes are included and were reused in this publication, without plotting again.

The offline snapshot exporter requires exact reviewed source hashes. It copies accepted report values and the dated incomplete disposition; it is not an acceptance engine and cannot declare study completion. See INCORPORATE.md for adding future independently accepted results.

## Public provenance

The public disposition uses logical source IDs and original SHA-256 hashes instead of private storage paths, account/resource identifiers or raw administrative records. The original private report and evidence remain immutable. The analysis-plan appendix replaces one absolute report-package location with a descriptive name; all scientific rules are unchanged. The public PDF was rendered from these public copies. It is not byte-identical to the private PDF because of that location redaction and PDF rendering metadata.

No editable ZIP is newly offered. The repository contains the editable sources. Historical paper03 provenance already in the parent commit is preserved; this update does not newly bundle those private-location records. The current paper04 provenance manifest identifies the exact new public payload. Earlier PDFs remain available in Git history.
