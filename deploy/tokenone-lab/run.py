#!/usr/bin/env python3
"""Launch the project's New API release with private lab or development settings."""

import argparse
import json
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("profile", choices=("lab", "dev"))
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[2]
    root = project / "data" / "tokenone-lab"
    settings_path = root / args.profile / "environment.json"
    if settings_path.stat().st_mode & 0o077:
        raise SystemExit("environment.json must have mode 0600")
    settings = json.loads(settings_path.read_text())
    if not isinstance(settings, dict) or not all(
        isinstance(key, str) and isinstance(value, str)
        for key, value in settings.items()
    ):
        raise SystemExit("environment.json must contain string environment values")
    expected_port = "55200" if args.profile == "lab" else "55210"
    if settings.get("PORT") != expected_port or not settings.get("SQL_DSN"):
        raise SystemExit("unexpected port or missing existing database configuration")
    binary = root / "current" / "new-api"
    logs = root / args.profile / "logs"
    logs.mkdir(mode=0o700, parents=True, exist_ok=True)
    environment = os.environ.copy()
    environment.update(settings)
    os.chdir(project)
    os.execve(str(binary), [str(binary), "--log-dir", str(logs)], environment)


if __name__ == "__main__":
    main()
