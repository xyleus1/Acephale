# Acephale corrective study

[Read the PDF](acephale-study.pdf) or the [editable manuscript](paper/manuscript.md).

This package contains the completed 36-run development and 96-run held-out custom tau-compatible pilot, preserving frozen run identities and all recorded outcomes. Database reward and constraint-clean results are distinct. The native policy abstained from speculative execution in these cohorts; these results do not measure the benefit of executed speculative reads. Timing, uncertainty, coverage, qualified serving evidence and limitations are reported in the paper. Hosted usage is provider-usage-derived, not a reconciled invoice.

Exact hosted model identifiers and source hashes are in [hosted-model provenance](provenance/hosted-models.json).

## Numerical reproduction

Use the pinned environment in each reproduction directory and ordinary Python, without isolated mode (-I), because the original functions import sibling modules:

    python reproduction/development/reproduce_native.py --input reproduction/development/native-statistical-inputs.json --expected reproduction/development/original-numerical-sections.json --output reproduced-development.json
    python reproduction/heldout/reproduce_native.py --input reproduction/heldout/native-statistical-inputs.json --expected reproduction/heldout/original-numerical-sections.json --output reproduced-heldout.json

Both were run once on AWS and matched the original numerical sections. [Parity evidence](provenance/numerical-reproduction.json) records immutable hashes. The nine files per stage preserve unchanged original estimators, selected rows, nulls, failure denominators, family identities and seed pairing.

## Sources and history

The paper directory contains editable text, figures, portable rendering sources and scientific companion projections. Private deployment paths and transport identifiers are omitted from projected companions; the file manifest retains original and public hashes. The PDF bytes are unchanged. Retained replay/training assets are distinct from corrective native results. Earlier unsuccessful or exploratory attempts remain in the [historical package](../final-study-20261122/), which is not overwritten.

The [corrective implementation archive](../../infra/aws-continuation/corrective-study-20261122/) records original/public source hashes and distinguishes executed from prepared code.
