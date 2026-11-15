"""Content backup and restore.

The program is kept on GitHub; the content it accumulates (``data/`` and
``assets/``) is kept only on this PC. This module is the safety net for that
content: it copies it into dated snapshot folders on another drive, checks
those snapshots, and puts one back — which is also how the content is moved
to another PC.

Standard library only and no package-relative imports, so besides being used
by the server it runs as a plain script on a PC that has nothing but Python:

    python backend/app/content_backup.py backup
    python backend/app/content_backup.py list
    python backend/app/content_backup.py verify
    python backend/app/content_backup.py restore

See docs/backup-restore.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import socket
import sqlite3
import stat
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterator, Optional

ROOT_DIR = Path(__file__).resolve().parents[2]
DB_NAME = "notes_db.sqlite3"
CONFIG_NAME = "backup_config.json"
MANIFEST_NAME = "manifest.json"
LAST_RUN_NAME = "last_run.json"
FORMAT = 1
DEFAULT_KEEP = 30
AUTO_INTERVAL_HOURS = 24
AUTO_START_DELAY_SECONDS = 60
AUTO_CHECK_SECONDS = 3600

LABELS = ("auto", "manual", "before-restore")
_NAME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{6}_(" + "|".join(LABELS) + r")$")
_PARTIAL_PREFIX = ".partial_"
_DB_SIDE_SUFFIXES = ("-wal", "-shm", "-journal")

_run_lock = threading.Lock()
# Last run per destination, kept in memory as well in case the destination
# itself can't be written to.
_last_runs: dict[str, dict[str, Any]] = {}


class BackupError(Exception):
    pass


# ---------------------------------------------------------------- settings


def default_dest(root: Path = ROOT_DIR) -> Path:
    # A different drive from the project when there is one, so a failed disk
    # doesn't take the backup with it.
    system_drive = os.environ.get("SystemDrive")
    if system_drive and root.drive.upper() != system_drive.upper():
        return Path(system_drive + "\\") / "POCTraderBR_Backup"
    return Path.home() / "POCTraderBR_Backup"


def load_config(root: Path = ROOT_DIR) -> dict[str, Any]:
    """Settings from data/backup_config.json ({"dest", "keep", "auto"}), all optional."""
    root = _plain(root)
    cfg: dict[str, Any] = {"dest": str(default_dest(root)), "keep": DEFAULT_KEEP, "auto": True}
    try:
        saved = json.loads((root / "data" / CONFIG_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        saved = {}
    if isinstance(saved, dict):
        if isinstance(saved.get("dest"), str) and saved["dest"].strip():
            cfg["dest"] = saved["dest"].strip()
        if isinstance(saved.get("keep"), int) and saved["keep"] > 0:
            cfg["keep"] = saved["keep"]
        if isinstance(saved.get("auto"), bool):
            cfg["auto"] = saved["auto"]
    if os.environ.get("POCTRADER_BACKUP_DIR"):
        cfg["dest"] = os.environ["POCTRADER_BACKUP_DIR"]
    if os.environ.get("POCTRADER_AUTO_BACKUP") == "0":
        cfg["auto"] = False
    return cfg


def same_drive(root: Path, dest: Path) -> bool:
    root, dest = _plain(root), _plain(dest)
    return bool(root.drive) and root.drive.upper() == Path(os.path.abspath(dest)).drive.upper()


# ----------------------------------------------------------------- helpers


def _long(path: Path) -> Path:
    # Snapshot paths get deep (dest/snapshot/assets/<id>/<id>_….png). Past 260
    # characters Windows refuses a path unless it is given in this form.
    if os.name != "nt":
        return Path(path)
    text = os.path.abspath(path)
    if text.startswith("\\\\?\\"):
        return Path(text)
    if text.startswith("\\\\"):
        return Path("\\\\?\\UNC\\" + text[2:])
    return Path("\\\\?\\" + text)


def _plain(path: Path) -> Path:
    """The usual spelling of a _long() path, for messages and for SQLite."""
    text = str(path)
    if text.startswith("\\\\?\\UNC\\"):
        return Path("\\\\" + text[8:])
    if text.startswith("\\\\?\\"):
        return Path(text[4:])
    return Path(path)


def _rmtree(path: Path) -> None:
    # Copied files keep their read-only attribute, which stops rmtree on Windows.
    def retry(func: Callable[..., Any], target: str, _exc: Any) -> None:
        os.chmod(target, stat.S_IWRITE)
        func(target)

    path = _long(path)
    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=retry)
    else:
        shutil.rmtree(path, onerror=retry)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fin:
        while chunk := fin.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def _copy_hashed(src: Path, dst: Path) -> str:
    digest = hashlib.sha256()
    with open(src, "rb") as fin, open(dst, "wb") as fout:
        while chunk := fin.read(1 << 20):
            digest.update(chunk)
            fout.write(chunk)
    shutil.copystat(src, dst)
    return digest.hexdigest()


def _is_db_file(name: str) -> bool:
    return name == DB_NAME or (name.startswith(DB_NAME) and name.endswith(_DB_SIDE_SUFFIXES))


def _content_files(root: Path) -> Iterator[tuple[str, Path]]:
    """Every content file under data/ and assets/ except the DB, as (posix relative path, path)."""
    root = _long(root)
    for top in ("data", "assets"):
        base = root / top
        if not base.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames.sort()
            for filename in sorted(filenames):
                if top == "data" and _is_db_file(filename):
                    continue
                path = Path(dirpath) / filename
                yield path.relative_to(root).as_posix(), path


def _sqlite_path(db: Path) -> str:
    # The usual spelling where it fits (the live DB is opened the same way the
    # server opens it); SQLite also takes the long form for deeper folders.
    plain = os.path.abspath(_plain(db))
    return plain if len(plain) < 240 else str(_long(db))


def _snapshot_db(src_db: Path, dst_db: Path) -> None:
    # The backup API gives a consistent copy while the server is writing. Copying
    # the file is not enough in WAL mode: recent changes sit in the -wal file.
    src = sqlite3.connect(_sqlite_path(src_db), timeout=30)
    try:
        dst = sqlite3.connect(_sqlite_path(dst_db))
        try:
            src.backup(dst)
            # One plain file, so the snapshot has no -wal/-shm to carry around.
            dst.execute("PRAGMA journal_mode=DELETE")
        finally:
            dst.close()
    finally:
        src.close()


def _inspect_db(db: Path) -> dict[str, Any]:
    # Read-only and immutable: looking at a snapshot must not leave files in it.
    escaped = _sqlite_path(db).replace("%", "%25").replace("?", "%3f").replace("#", "%23")
    con = sqlite3.connect(f"file:{escaped}?mode=ro&immutable=1", uri=True)
    try:
        integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        tables: dict[str, int] = {}
        names = con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        for (name,) in names:
            tables[name] = con.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
    finally:
        con.close()
    return {"integrity": integrity, "tables": tables}


def _git_commit(root: Path) -> Optional[str]:
    # Which version of the program the content was written by — best effort.
    try:
        head = (root / ".git" / "HEAD").read_text(encoding="utf-8").strip()
        if head.startswith("ref: "):
            return (root / ".git" / head[5:]).read_text(encoding="utf-8").strip()
        return head
    except OSError:
        return None


def _signature(db_sha: str, files: dict[str, dict[str, Any]]) -> str:
    digest = hashlib.sha256(db_sha.encode())
    for rel in sorted(files):
        digest.update(f"\n{rel}\t{files[rel]['sha256']}".encode("utf-8"))
    return digest.hexdigest()


# --------------------------------------------------------------- snapshots


def read_manifest(snapshot: Path) -> dict[str, Any]:
    try:
        manifest = json.loads((_long(snapshot) / MANIFEST_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise BackupError(f"백업 정보 파일({MANIFEST_NAME})을 읽을 수 없습니다: {_plain(snapshot)} ({exc})") from exc
    if not isinstance(manifest, dict) or "files" not in manifest or "db" not in manifest:
        raise BackupError(f"백업 정보 파일의 형식이 다릅니다: {_plain(snapshot)}")
    return manifest


def list_snapshots(dest: Path) -> list[tuple[Path, dict[str, Any]]]:
    """Finished snapshots in dest, oldest first."""
    found: list[tuple[Path, dict[str, Any]]] = []
    dest = _long(dest)
    if not dest.is_dir():
        return found
    for path in sorted(dest.iterdir()):
        if path.is_dir() and _NAME_RE.match(path.name):
            try:
                found.append((path, read_manifest(path)))
            except BackupError:
                continue
    return found


def latest_snapshot(dest: Path) -> Optional[tuple[Path, dict[str, Any]]]:
    dest = _long(dest)
    if not dest.is_dir():
        return None
    for path in sorted(dest.iterdir(), reverse=True):
        if path.is_dir() and _NAME_RE.match(path.name):
            try:
                return path, read_manifest(path)
            except BackupError:
                continue
    return None


def read_last_run(dest: Path) -> Optional[dict[str, Any]]:
    try:
        saved = json.loads((_long(dest) / LAST_RUN_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        saved = None
    candidates = [r for r in (saved, _last_runs.get(str(_long(dest)))) if isinstance(r, dict) and "time" in r]
    return max(candidates, key=lambda r: r["time"]) if candidates else None


def _record_run(dest: Path, record: dict[str, Any]) -> None:
    record = {"time": time.time(), **record}
    _last_runs[str(_long(dest))] = record
    try:
        (_long(dest) / LAST_RUN_NAME).write_text(json.dumps(record, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError:
        pass  # the in-memory copy still reports it


def _clear_stale_partials(dest: Path) -> None:
    for path in dest.iterdir():
        if path.is_dir() and path.name.startswith(_PARTIAL_PREFIX):
            if time.time() - path.stat().st_mtime > 24 * 3600:
                _rmtree(path)


def _make_snapshot(label: str, root: Path, dest: Path) -> dict[str, Any]:
    root, dest = _long(root), _long(dest)
    src_db = root / "data" / DB_NAME
    if not src_db.is_file():
        raise BackupError(f"DB 파일이 없습니다: {_plain(src_db)}")
    dest.mkdir(parents=True, exist_ok=True)
    _clear_stale_partials(dest)

    started = time.time()
    name = f"{datetime.now():%Y-%m-%d_%H%M%S}_{label}"
    final = dest / name
    if final.exists():
        raise BackupError(f"같은 이름의 백업이 이미 있습니다: {_plain(final)}")
    previous = latest_snapshot(dest)
    previous_files: dict[str, Any] = previous[1]["files"] if previous else {}

    work = dest / f"{_PARTIAL_PREFIX}{name}_{os.getpid()}"
    work.mkdir()
    try:
        warnings: list[str] = []
        (work / "data").mkdir()
        db_copy = work / "data" / DB_NAME
        _snapshot_db(src_db, db_copy)
        db = _inspect_db(db_copy)
        db["size"] = db_copy.stat().st_size
        db["sha256"] = _sha256(db_copy)
        if db["integrity"] != "ok":
            warnings.append(f"DB 무결성 검사 결과가 ok가 아닙니다: {db['integrity']}")

        files: dict[str, dict[str, Any]] = {}
        linked = copied = total_bytes = 0
        for rel, src in _content_files(root):
            dst = work / rel
            try:
                st = src.stat()
                dst.parent.mkdir(parents=True, exist_ok=True)
                sha: Optional[str] = None
                old = previous_files.get(rel)
                if previous and old and old["size"] == st.st_size and old["mtime_ns"] == st.st_mtime_ns:
                    # Unchanged since the last snapshot: share its copy instead of
                    # storing the file again. Falls back to copying where hard
                    # links aren't possible (another volume, FAT/exFAT).
                    try:
                        os.link(previous[0] / rel, dst)
                        sha = old["sha256"]
                        linked += 1
                    except OSError:
                        sha = None
                if sha is None:
                    sha = _copy_hashed(src, dst)
                    copied += 1
                size = dst.stat().st_size
                files[rel] = {"size": size, "mtime_ns": st.st_mtime_ns, "sha256": sha}
                total_bytes += size
            except OSError as exc:
                warnings.append(f"{rel}: {exc}")

        signature = _signature(db["sha256"], files)
        if label == "auto" and previous and not warnings and previous[1].get("signature") == signature:
            _rmtree(work)
            return {"result": "unchanged", "snapshot": previous[0].name, "path": str(_plain(previous[0]))}

        manifest = {
            "format": FORMAT,
            "name": name,
            "label": label,
            "created": datetime.now().isoformat(timespec="seconds"),
            "source_root": str(_plain(root)),
            "host": platform.node(),
            "git_commit": _git_commit(root),
            "db": db,
            "totals": {"files": len(files), "bytes": total_bytes + db["size"], "linked": linked, "copied": copied},
            "signature": signature,
            "warnings": warnings,
            "files": files,
        }
        (work / MANIFEST_NAME).write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
        os.rename(work, final)
    except BaseException:
        shutil.rmtree(work, ignore_errors=True)
        raise
    return {
        "result": "created",
        "snapshot": name,
        "path": str(_plain(final)),
        "files": len(files),
        "bytes": manifest["totals"]["bytes"],
        "linked": linked,
        "copied": copied,
        "warnings": warnings,
        "seconds": round(time.time() - started, 1),
    }


def _prune(dest: Path, keep: int) -> list[str]:
    """Drop the oldest automatic snapshots beyond `keep`. Manual ones are never removed."""
    dest = _long(dest)
    autos = [path for path, manifest in list_snapshots(dest) if manifest.get("label") == "auto"]
    removed = []
    for path in autos[:-keep] if keep > 0 else []:
        if path.parent == dest and _NAME_RE.match(path.name):
            _rmtree(path)
            removed.append(path.name)
    return removed


def run_backup(
    label: str = "manual",
    root: Path = ROOT_DIR,
    dest: Optional[Path] = None,
    keep: Optional[int] = None,
) -> dict[str, Any]:
    """Make one snapshot of root's content in dest. Raises BackupError / OSError on failure."""
    if label not in LABELS:
        raise BackupError(f"알 수 없는 종류: {label}")
    cfg = load_config(root)
    dest = Path(dest) if dest else Path(cfg["dest"])
    keep = keep if keep is not None else cfg["keep"]
    with _run_lock:
        try:
            outcome = _make_snapshot(label, root, dest)
            if not outcome.get("warnings"):
                outcome["pruned"] = _prune(dest, keep)
        except Exception as exc:
            _record_run(dest, {"ok": False, "label": label, "error": str(exc) or type(exc).__name__})
            raise
        _record_run(
            dest,
            {
                "ok": True,
                "label": label,
                "result": outcome["result"],
                "snapshot": outcome["snapshot"],
                "warnings": outcome.get("warnings", []),
            },
        )
        return outcome


def verify_snapshot(snapshot: Path) -> list[str]:
    """Re-read every file of a snapshot against its manifest. Returns the problems found."""
    snapshot = _long(snapshot)
    try:
        manifest = read_manifest(snapshot)
    except BackupError as exc:
        return [str(exc)]
    problems: list[str] = []
    db_copy = snapshot / "data" / DB_NAME
    if not db_copy.is_file():
        problems.append(f"DB 파일이 없습니다: data/{DB_NAME}")
    else:
        if _sha256(db_copy) != manifest["db"].get("sha256"):
            problems.append("DB 파일의 내용이 백업할 때와 다릅니다")
        try:
            integrity = _inspect_db(db_copy)["integrity"]
            if integrity != "ok":
                problems.append(f"DB 무결성 검사: {integrity}")
        except sqlite3.Error as exc:
            problems.append(f"DB를 열 수 없습니다: {exc}")
    for rel, info in manifest["files"].items():
        path = snapshot / rel
        if not path.is_file():
            problems.append(f"파일이 없습니다: {rel}")
        elif path.stat().st_size != info["size"] or _sha256(path) != info["sha256"]:
            problems.append(f"파일의 내용이 백업할 때와 다릅니다: {rel}")
    return problems


def _server_running(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except OSError:
        return False


def _raw_copy_db(root: Path, dest: Path) -> Path:
    root, dest = _long(root), _long(dest)
    folder = dest / f"{datetime.now():%Y-%m-%d_%H%M%S}_unreadable-db"
    folder.mkdir(parents=True)
    for suffix in ("",) + _DB_SIDE_SUFFIXES:
        src = root / "data" / (DB_NAME + suffix)
        if src.is_file():
            shutil.copy2(src, folder / src.name)
    return folder


def restore_snapshot(
    snapshot: Path,
    root: Path = ROOT_DIR,
    dest: Optional[Path] = None,
    port: int = 8000,
) -> dict[str, Any]:
    """Put a snapshot's content into root, replacing what is there.

    What is there now is first saved as a "before-restore" snapshot, so a
    restore can itself be undone.
    """
    snapshot, root = _long(snapshot), _long(root)
    problems = verify_snapshot(snapshot)
    if problems:
        raise BackupError("이 백업은 온전하지 않아 복원하지 않습니다:\n  " + "\n  ".join(problems[:20]))
    if port and _server_running(port):
        raise BackupError(f"서버가 켜져 있습니다 (포트 {port}). 서버를 끈 뒤 다시 실행하세요.")
    manifest = read_manifest(snapshot)

    target_db = root / "data" / DB_NAME
    before: Optional[str] = None
    raw_copy: Optional[Path] = None
    if target_db.is_file():
        try:
            before = run_backup("before-restore", root, dest)["snapshot"]
        except sqlite3.Error:
            # A DB too damaged to read is the very case a restore is for. Keep
            # the damaged files as they are instead of refusing to go on.
            raw_copy = _raw_copy_db(root, Path(dest) if dest else Path(load_config(root)["dest"]))

    (root / "data").mkdir(parents=True, exist_ok=True)
    # The old -wal/-shm must go with the old DB: left next to the restored file
    # they would be replayed into it.
    for suffix in ("",) + _DB_SIDE_SUFFIXES:
        (root / "data" / (DB_NAME + suffix)).unlink(missing_ok=True)
    shutil.copy2(snapshot / "data" / DB_NAME, target_db)

    copied = kept = 0
    for rel, info in manifest["files"].items():
        dst = root / rel
        if dst.is_file():
            st = dst.stat()
            if st.st_size == info["size"] and st.st_mtime_ns == info["mtime_ns"]:
                kept += 1
                continue
            os.chmod(dst, stat.S_IWRITE)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(snapshot / rel, dst)
        copied += 1

    # Files under assets/ that the snapshot doesn't have are removed only when
    # they were just saved in the before-restore snapshot.
    extra = [(rel, path) for rel, path in _content_files(root) if rel.startswith("assets/") and rel not in manifest["files"]]
    removed = 0
    if before:
        for _rel, path in extra:
            os.chmod(path, stat.S_IWRITE)
            path.unlink()
            removed += 1
        for dirpath, _dirnames, _filenames in os.walk(root / "assets", topdown=False):
            if Path(dirpath) != root / "assets" and not os.listdir(dirpath):
                os.rmdir(dirpath)

    db = _inspect_db(target_db)
    if db["integrity"] != "ok":
        raise BackupError(f"복원한 DB의 무결성 검사 결과가 ok가 아닙니다: {db['integrity']}")
    return {
        "snapshot": snapshot.name,
        "root": str(_plain(root)),
        "before": before,
        "raw_copy": str(_plain(raw_copy)) if raw_copy else None,
        "copied": copied,
        "kept": kept,
        "removed": removed,
        "left": 0 if before else len(extra),
        "tables": db["tables"],
    }


def status(root: Path = ROOT_DIR) -> dict[str, Any]:
    cfg = load_config(root)
    dest = _long(Path(cfg["dest"]))
    latest = latest_snapshot(dest)
    count = sum(1 for p in dest.iterdir() if p.is_dir() and _NAME_RE.match(p.name)) if dest.is_dir() else 0
    return {
        "dest": str(_plain(dest)),
        "auto": cfg["auto"],
        "keep": cfg["keep"],
        "same_drive": same_drive(root, dest),
        "count": count,
        "latest": None
        if latest is None
        else {
            "name": latest[0].name,
            "created": latest[1].get("created"),
            "label": latest[1].get("label"),
            "files": latest[1].get("totals", {}).get("files"),
            "bytes": latest[1].get("totals", {}).get("bytes"),
            "warnings": len(latest[1].get("warnings", [])),
        },
        "last_run": read_last_run(dest),
    }


# ---------------------------------------------------------------- automatic


def _auto_due(dest: Path) -> bool:
    last = read_last_run(dest)
    if not last or not last.get("ok"):
        return True
    return time.time() - last["time"] >= AUTO_INTERVAL_HOURS * 3600


def _auto_loop(root: Path) -> None:
    time.sleep(AUTO_START_DELAY_SECONDS)
    while True:
        try:
            cfg = load_config(root)
            if cfg["auto"] and _auto_due(Path(cfg["dest"])):
                outcome = run_backup("auto", root)
                print(f"[content-backup] {outcome['result']}: {outcome['path']}", flush=True)
        except Exception as exc:  # the server must keep running whatever happens here
            print(f"[content-backup] 자동 백업 실패: {exc}", flush=True)
        time.sleep(AUTO_CHECK_SECONDS)


def start_auto_backup(root: Path = ROOT_DIR) -> None:
    """Called once by the server: a snapshot a day, checked hourly, retried while failing."""
    if load_config(root)["auto"]:
        threading.Thread(target=_auto_loop, args=(root,), name="content-backup", daemon=True).start()


# --------------------------------------------------------------------- CLI


def _mb(size: Optional[int]) -> str:
    return f"{(size or 0) / 1024 / 1024:,.1f} MB"


def _resolve_snapshot(arg: Optional[str], dest: Path) -> Path:
    if arg:
        for candidate in (Path(arg), dest / arg):
            if (candidate / MANIFEST_NAME).is_file():
                return candidate
        raise BackupError(f"백업을 찾을 수 없습니다: {arg}")
    latest = latest_snapshot(dest)
    if latest is None:
        raise BackupError(f"백업이 없습니다: {dest}")
    return latest[0]


def _describe(snapshot: Path, manifest: dict[str, Any]) -> str:
    tables = manifest["db"].get("tables", {})
    rows = ", ".join(f"{name} {count}" for name, count in tables.items() if count)
    return (
        f"  백업      : {_plain(snapshot)}\n"
        f"  만든 때   : {manifest.get('created')} ({manifest.get('label')})\n"
        f"  파일      : {manifest['totals']['files']}개 + DB, {_mb(manifest['totals']['bytes'])}\n"
        f"  DB 행 수  : {rows or '(비어 있음)'}"
    )


def _cmd_backup(args: argparse.Namespace, root: Path, dest: Path) -> int:
    print(f"백업 중… {root} → {dest}")
    outcome = run_backup("manual", root, dest, args.keep)
    print(f"완료: {outcome['path']}")
    print(
        f"  파일 {outcome['files']}개 + DB, {_mb(outcome['bytes'])} "
        f"(새로 복사 {outcome['copied']}개, 이전 백업과 공유 {outcome['linked']}개), {outcome['seconds']}초"
    )
    for warning in outcome["warnings"][:10]:
        print(f"  주의: {warning}")
    if len(outcome["warnings"]) > 10:
        print(f"  … 외 {len(outcome['warnings']) - 10}건 (백업 폴더의 {MANIFEST_NAME} 에 모두 있음)")
    if same_drive(root, dest):
        print("  주의: 백업 위치가 프로그램과 같은 드라이브입니다. 디스크 고장에는 대비가 되지 않습니다.")
    return 1 if outcome["warnings"] else 0


def _cmd_list(_args: argparse.Namespace, _root: Path, dest: Path) -> int:
    snapshots = list_snapshots(dest)
    print(f"백업 위치: {dest} ({len(snapshots)}개)")
    for path, manifest in snapshots:
        note = f"  주의 {len(manifest['warnings'])}건" if manifest.get("warnings") else ""
        print(f"  {path.name:<34} 파일 {manifest['totals']['files']:>5}개  {_mb(manifest['totals']['bytes']):>12}{note}")
    return 0


def _cmd_verify(args: argparse.Namespace, _root: Path, dest: Path) -> int:
    snapshot = _resolve_snapshot(args.snapshot, dest)
    print(f"검사 중… {_plain(snapshot)}")
    problems = verify_snapshot(snapshot)
    if problems:
        print(f"문제 {len(problems)}건:")
        for problem in problems:
            print(f"  {problem}")
        return 1
    manifest = read_manifest(snapshot)
    print(f"이상 없음: 파일 {manifest['totals']['files']}개와 DB가 백업할 때와 같습니다.")
    return 0


def _cmd_restore(args: argparse.Namespace, root: Path, dest: Path) -> int:
    snapshot = _resolve_snapshot(args.snapshot, dest)
    manifest = read_manifest(snapshot)
    if args.port and _server_running(args.port):
        raise BackupError(f"서버가 켜져 있습니다 (포트 {args.port}). 서버를 끈 뒤 다시 실행하세요.")
    print("이 백업의 내용으로 되돌립니다.")
    print(_describe(snapshot, manifest))
    print(f"  되돌릴 곳 : {root}")
    if (root / "data" / DB_NAME).is_file():
        print(f"  지금 있는 내용은 먼저 {dest} 에 'before-restore' 백업으로 남긴 뒤 바꿉니다.")
    if not args.yes:
        answer = input("계속하려면 yes 를 입력하세요: ").strip().lower()
        if answer != "yes":
            print("취소했습니다. 바꾼 것은 없습니다.")
            return 1
    outcome = restore_snapshot(snapshot, root, dest, args.port)
    print("복원 완료.")
    if outcome["before"]:
        print(f"  바꾸기 전의 내용: {_plain(dest) / outcome['before']}")
    if outcome["raw_copy"]:
        print(f"  읽을 수 없던 이전 DB 파일은 그대로 옮겨 두었습니다: {outcome['raw_copy']}")
    print(f"  복사 {outcome['copied']}개, 그대로 둔 것 {outcome['kept']}개, 지운 것 {outcome['removed']}개")
    if outcome["left"]:
        print(f"  백업에 없는 파일 {outcome['left']}개는 지우지 않고 두었습니다 (assets/).")
    print("  이제 서버를 켜면 됩니다.")
    return 0


def _cmd_status(_args: argparse.Namespace, root: Path, _dest: Path) -> int:
    print(json.dumps(status(root), ensure_ascii=False, indent=1))
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    parser = argparse.ArgumentParser(description="data/ 와 assets/ 의 백업 · 검사 · 복원")
    parser.add_argument("--root", help="프로그램 폴더 (기본: 이 파일이 든 저장소)")
    parser.add_argument("--dest", help="백업 위치 (기본: data/backup_config.json 의 dest, 없으면 다른 드라이브의 POCTraderBR_Backup)")
    # The same two options after the command too (backup.bat --dest E:\…), without
    # their absence there wiping a value given before it.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--root", default=argparse.SUPPRESS, help=argparse.SUPPRESS)
    common.add_argument("--dest", default=argparse.SUPPRESS, help=argparse.SUPPRESS)
    sub = parser.add_subparsers(dest="command", required=True)
    p_backup = sub.add_parser("backup", parents=[common], help="지금 백업")
    p_backup.add_argument("--keep", type=int, help="남겨 둘 자동 백업 개수")
    p_backup.set_defaults(func=_cmd_backup)
    sub.add_parser("list", parents=[common], help="백업 목록").set_defaults(func=_cmd_list)
    p_verify = sub.add_parser("verify", parents=[common], help="백업이 온전한지 검사")
    p_verify.add_argument("snapshot", nargs="?", help="백업 이름이나 폴더 (기본: 가장 최근)")
    p_verify.set_defaults(func=_cmd_verify)
    p_restore = sub.add_parser("restore", parents=[common], help="백업의 내용으로 되돌리기")
    p_restore.add_argument("snapshot", nargs="?", help="백업 이름이나 폴더 (기본: 가장 최근)")
    p_restore.add_argument("--yes", action="store_true", help="묻지 않고 진행")
    p_restore.add_argument("--port", type=int, default=8000, help="서버가 켜져 있는지 볼 포트 (0이면 보지 않음)")
    p_restore.set_defaults(func=_cmd_restore)
    sub.add_parser("status", parents=[common], help="설정과 최근 백업").set_defaults(func=_cmd_status)
    args = parser.parse_args(argv)

    root = Path(args.root).resolve() if args.root else ROOT_DIR
    dest = Path(args.dest) if args.dest else Path(load_config(root)["dest"])
    try:
        return args.func(args, root, dest)
    except (BackupError, OSError, sqlite3.Error) as exc:
        print(f"실패: {exc}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
