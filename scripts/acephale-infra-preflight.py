"""Read-only host preflight; prints credential presence only, never values."""
from pathlib import Path
import runpy
import sys

control = Path(__file__).resolve().parents[1] / "infra" / "acephale-infra-v1" / "control.py"
sys.argv = [str(control), "preflight", *sys.argv[1:]]
runpy.run_path(str(control), run_name="__main__")
