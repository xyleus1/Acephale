"""Opt-in real Docker regression for public COPY inputs under umask 027."""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

import pytest

PUBLIC = [
    "/app/research/acephale/src/acephale/__init__.py",
    "/app/research/acephale/src/acephale/nested/module.py",
    "/app/src/lib/acephale/contracts/v1/schema.json",
    "/app/research/acephale/pyproject.toml",
    "/app/research/acephale/training/pyproject.toml",
    "/app/research/acephale/training/uv.lock",
    "/tmp/acephale-trainer-packages.txt",
]
PRIVATE = [
    "/app/research/acephale/training/.venv/private-sentinel",
    "/app/private-output/private-sentinel",
    "/model/private-sentinel",
]


def checked(command):
    return subprocess.run(command, check=True, capture_output=True, text=True, timeout=60)


@pytest.fixture(scope="module")
def permission_images(tmp_path_factory):
    if os.environ.get("ACEPHALE_TEST_DOCKER_PERMISSIONS") != "1":
        pytest.skip("Set ACEPHALE_TEST_DOCKER_PERMISSIONS=1 with Docker and the pinned base cached")
    source = Path(__file__).resolve().parents[3] / "infra/acephale-infra-v1/trainer.Dockerfile"
    contents = source.read_text()
    base = contents.splitlines()[0].removeprefix("FROM ")
    # Inspect first so this optional offline test never implicitly pulls a base.
    checked(["docker", "image", "inspect", base])
    commands = contents.replace("\\\n", " ").splitlines()
    normalization = [line for line in commands if line.startswith("RUN chmod -R a+rX ")]
    assert len(normalization) == 1
    assert contents.index("RUN chmod -R a+rX ") > contents.index("RUN uv sync ")
    directory = tmp_path_factory.mktemp("trainer-public-permissions")
    seed = "\n".join([
        "import os", "from pathlib import Path", "os.umask(0o027)",
        f"paths = {PUBLIC + PRIVATE!r}",
        "for name in paths:",
        "    path = Path(name)",
        "    path.parent.mkdir(parents=True, exist_ok=True)",
        "    path.write_text('# fixture\\n')",
        "    path.chmod(0o640)",
        "for root in ('/app', '/model'):",
        "    for path in [Path(root), *Path(root).rglob('*')]:",
        "        if path.is_dir(): path.chmod(0o750)",
    ])
    (directory / "seed.py").write_text(seed)
    (directory / "Dockerfile").write_text(
        f"FROM {base} AS restricted\nCOPY seed.py /seed.py\nRUN python /seed.py\n"
        f"FROM restricted AS repaired\n{normalization[0]}\n"
    )
    images = []
    try:
        for stage in ("restricted", "repaired"):
            iid = directory / (stage + ".id")
            checked(["docker", "build", "--network", "none", "--pull=false", "--target", stage,
                     "--iidfile", str(iid), str(directory)])
            image = iid.read_text().strip()
            assert re.fullmatch(r"sha256:[a-f0-9]{64}", image)
            images.append(image)
        yield images
    finally:
        for image in reversed(images):
            checked(["docker", "image", "rm", image])


@pytest.mark.parametrize("uid", [1000, 10001])
def test_public_inputs_readable_but_private_modes_unchanged(permission_images, uid):
    probe = "\n".join([
        "import importlib, json, os, sys", "from pathlib import Path",
        f"assert os.getuid() == {uid}",
        f"assert all(Path(name).read_text() == '# fixture\\n' for name in {PUBLIC!r})",
        "sys.path.insert(0, '/app/research/acephale/src')",
        "importlib.import_module('acephale.nested.module')",
        f"for name in {PRIVATE!r}:",
        "    assert not os.access(name, os.R_OK), name",
        "print(json.dumps({'uid': os.getuid(), 'publicRead': True, 'privateRead': False}))",
    ])
    for image, expected in zip(permission_images, (False, True), strict=True):
        result = subprocess.run(["docker", "run", "--rm", "--network", "none", "--cap-drop", "ALL",
                                 "--security-opt", "no-new-privileges", "--user", f"{uid}:{uid}",
                                 image, "python", "-B", "-c", probe],
                                check=False, capture_output=True, text=True, timeout=30)
        assert (result.returncode == 0) is expected, result.stderr
        if expected:
            assert json.loads(result.stdout) == {"uid": uid, "publicRead": True, "privateRead": False}
    # Root can inspect sentinel modes without needing private read permission.
    mode_probe = "from pathlib import Path; " + "; ".join(
        f"assert Path({name!r}).stat().st_mode & 0o777 == 0o640" for name in PRIVATE)
    checked(["docker", "run", "--rm", "--network", "none", permission_images[1],
             "python", "-B", "-c", mode_probe])
