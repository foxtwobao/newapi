#!/usr/bin/env python3
"""Build a lab release: python3 deploy/tokenone-lab/build.py 20261002.4.

Uses fetched upstream/main and its nearest new-api release tag. Build web/dist
with `cd web && bun run build` first whenever frontend sources have changed.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("build_id", help="Local build identifier, e.g. 20261002.4")
    parser.add_argument("--print-version", action="store_true", help="Resolve without building")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*", args.build_id):
        parser.error("build_id must contain dot-separated letters, digits or hyphens")

    project = Path(__file__).resolve().parents[2]
    os.chdir(project)
    upstream_commit = subprocess.check_output(
        ["git", "merge-base", "HEAD", "upstream/main"], text=True
    ).strip()
    upstream_version = subprocess.check_output(
        ["git", "describe", "--tags", "--match", "v[0-9]*", "--abbrev=0", upstream_commit],
        text=True,
    ).strip()
    if not re.fullmatch(r"v\d+(?:\.\d+){2,}(?:-(?:alpha|beta|rc|patch)(?:\.\d+)?(?:-i18nfix\.\d+)?)?", upstream_version):
        raise SystemExit("Upstream tag cannot be compared by the release checker")
    # Do not label the build with an unmerged latest release or an unpublished tag.
    request = Request(
        f"https://api.github.com/repos/QuantumNous/new-api/releases/tags/{upstream_version}",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "new-api-lab-build"},
    )
    with urlopen(request, timeout=15) as response:
        release_info = json.load(response)
    if release_info.get("draft") is not False or not release_info.get("published_at") or release_info.get("tag_name") != upstream_version:
        raise SystemExit("Upstream tag is not a published QuantumNous/new-api release")
    version = f"{upstream_version}+composite.{args.build_id}"
    print(version, flush=True)
    if args.print_version:
        return

    frontend = project / "web/dist/index.html"
    if not frontend.is_file():
        raise SystemExit("Build the frontend with `cd web && bun run build` first")
    root = project / "data/tokenone-lab"
    release = root / "releases" / f"composite-{args.build_id}"
    release.mkdir(mode=0o700, parents=True, exist_ok=False)
    patch = subprocess.check_output(["git", "diff", "HEAD", "--binary"])
    (release / "source.patch").write_bytes(patch)
    script = Path(__file__).read_bytes()
    (release / "build.py").write_bytes(script)
    environment = os.environ.copy()
    environment.setdefault("GOMAXPROCS", "2")
    subprocess.run(
        ["go", "build", "-p", "2", "-ldflags",
         f"-X github.com/QuantumNous/new-api/common.Version={version}",
         "-o", str(release / "new-api"), "."],
        env=environment, check=True,
    )
    manifest = {
        "version": version,
        "base_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
        "upstream_commit": upstream_commit,
        "upstream_version": upstream_version,
        "upstream_release_url": release_info["html_url"],
        "source_patch_sha256": hashlib.sha256(patch).hexdigest(),
        "build_script_sha256": hashlib.sha256(script).hexdigest(),
        "binary_sha256": hashlib.sha256((release / "new-api").read_bytes()).hexdigest(),
        "frontend_index_sha256": hashlib.sha256(frontend.read_bytes()).hexdigest(),
        "previous_release": os.readlink(root / "current") if (root / "current").is_symlink() else None,
    }
    (release / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Built {release}")


if __name__ == "__main__":
    main()
