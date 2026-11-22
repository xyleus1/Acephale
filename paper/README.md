# Acephale working manuscript and accepted-result figures

This is an editable manuscript with accepted retained seed17 replay/calibration findings. Native and seed29 outcome sections remain explicitly incomplete. It is not a complete-study report.

## Reproduce on AWS

1. Run /srv/acephale/workspaces/report/locked-environments-02/analysis5a/bin/python -B /srv/acephale/workspaces/report/manuscript-aws-02/plot_retained.py
2. Render with /srv/acephale/workspaces/root/paper-render-01/venv/bin/python -B /srv/acephale/workspaces/report/paper-render-02/render.py --source /srv/acephale/workspaces/report/manuscript-aws-02 --output <new-output-directory>

The plot copies accepted estimates and confidence intervals; it does not fit models or rerun the bootstrap. Its only display arithmetic is completed minus scored for the mutually exclusive coverage categories. PNG, editable SVG and standalone PDF are produced together. Figure provenance lists exact input hashes and values. tables/paired-replay.csv retains the original paired estimands at full precision.

The original frozen methods are preserved byte for byte. Statistical results come from successful original report commands and their accepted component, manifest and report lineage. The PDF renderer is an operational derivative of root's existing renderer, adding figure support. The original renderer and earlier previews remain unchanged.

Final PDF review and publication belong to root. Operational execution belongs to the external execution owner; no deployment files or scientific assignments are changed by this writing workspace.
