"""File access helpers: case-insensitive lookup inside the MicroMac data dir."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "MicroMac"


def find(name: str, data_dir: Path = DATA_DIR) -> Path:
    """Case-insensitive lookup of `name` (may include GAME1/ prefix) under data_dir."""
    target = name.replace("\\", "/").lower()
    for p in data_dir.rglob("*"):
        if p.is_file() and p.relative_to(data_dir).as_posix().lower() == target:
            return p
    raise FileNotFoundError(name)


def read(name: str, data_dir: Path = DATA_DIR) -> bytes:
    return find(name, data_dir).read_bytes()


def list_files(data_dir: Path = DATA_DIR):
    return sorted(p.relative_to(data_dir).as_posix() for p in data_dir.rglob("*") if p.is_file())
