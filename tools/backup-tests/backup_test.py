"""Tests for backend/app/content_backup.py on a made-up project folder.

    backend/.venv/Scripts/python.exe -X utf8 tools/backup-tests/backup_test.py

Touches nothing real: the "project" and the backup destination are both
created in a temporary folder and removed at the end.
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import sqlite3
import stat
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend" / "app"))
import content_backup as cb  # noqa: E402

os.environ.pop("POCTRADER_BACKUP_DIR", None)

passed = 0


def check(condition: bool, what: str) -> None:
    global passed
    if not condition:
        raise AssertionError(what)
    passed += 1
    print(f"  ok  {what}")


def rows(db: Path) -> int:
    con = sqlite3.connect(str(db))
    try:
        return con.execute("SELECT COUNT(*) FROM notes").fetchone()[0]
    finally:
        con.close()


def next_second() -> None:
    # Snapshot names carry the time to the second.
    time.sleep(1.1)


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="backup_test_"))
    live = None
    try:
        root = tmp / "project"
        dest = tmp / "backups"
        (root / "data").mkdir(parents=True)
        (root / "assets" / "a").mkdir(parents=True)
        (root / "assets" / "b").mkdir(parents=True)
        (root / "data" / "log.md").write_text("기록 1\n", encoding="utf-8")
        (root / "assets" / "a" / "one.png").write_bytes(b"\x89PNG" + bytes(5000))
        (root / "assets" / "b" / "two.bin").write_bytes(os.urandom(300_000))
        locked = root / "assets" / "b" / "readonly.bin"
        locked.write_bytes(b"read only")
        os.chmod(locked, stat.S_IREAD)

        # A live database the way the server keeps it: WAL mode, connection
        # open, the newest rows still only in the -wal file.
        db = root / "data" / cb.DB_NAME
        live = sqlite3.connect(str(db))
        live.execute("PRAGMA journal_mode=WAL")
        live.execute("PRAGMA wal_autocheckpoint=0")
        live.execute("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)")
        live.executemany("INSERT INTO notes (body) VALUES (?)", [(f"노트 {i}",) for i in range(50)])
        live.commit()
        check((root / "data" / (cb.DB_NAME + "-wal")).stat().st_size > 0, "the test DB has rows waiting in the -wal file")

        print("first backup")
        first = cb.run_backup("manual", root, dest)
        snap1 = dest / first["snapshot"]
        check(first["result"] == "created" and snap1.is_dir(), "snapshot folder created")
        check(first["files"] == 4 and first["copied"] == 4 and first["linked"] == 0, "all 4 content files copied")
        check(rows(snap1 / "data" / cb.DB_NAME) == 50, "DB copy has the rows that were only in the -wal")
        check(sorted(p.name for p in (snap1 / "data").iterdir()) == ["log.md", cb.DB_NAME], "no -wal/-shm in the snapshot")
        check(cb.verify_snapshot(snap1) == [], "verify: clean")
        check(not [p for p in dest.iterdir() if p.name.startswith(".partial_")], "no partial folder left")
        manifest = cb.read_manifest(snap1)
        check(manifest["db"]["integrity"] == "ok" and manifest["db"]["tables"] == {"notes": 50}, "manifest records DB state")
        check(cb.read_last_run(dest)["ok"] is True, "last run recorded as ok")

        print("automatic backup, nothing changed")
        next_second()
        same = cb.run_backup("auto", root, dest)
        check(same["result"] == "unchanged" and same["snapshot"] == snap1.name, "skipped, points at the existing snapshot")
        check(len(cb.list_snapshots(dest)) == 1, "no second snapshot")

        print("automatic backup after changes")
        (root / "data" / "log.md").write_text("기록 1\n기록 2\n", encoding="utf-8")
        live.execute("INSERT INTO notes (body) VALUES ('노트 추가')")
        live.commit()
        second = cb.run_backup("auto", root, dest)
        snap2 = dest / second["snapshot"]
        check(second["result"] == "created" and second["copied"] == 1 and second["linked"] == 3, "1 changed file copied, 3 shared")
        check(os.path.samefile(snap1 / "assets/b/two.bin", snap2 / "assets/b/two.bin"), "unchanged file is the same file on disk")
        check(not os.path.samefile(snap1 / "data/log.md", snap2 / "data/log.md"), "changed file is a separate copy")
        check((snap1 / "data/log.md").read_text(encoding="utf-8") == "기록 1\n", "older snapshot keeps the old content")
        check(rows(snap2 / "data" / cb.DB_NAME) == 51 and rows(snap1 / "data" / cb.DB_NAME) == 50, "each snapshot has its own DB state")
        check(cb.verify_snapshot(snap2) == [], "verify: clean")

        print("verify notices damage")
        damaged = tmp / "damaged" / snap2.name
        shutil.copytree(snap2, damaged)
        target = damaged / "assets" / "b" / "two.bin"
        data = bytearray(target.read_bytes())
        data[1000] ^= 0xFF
        target.write_bytes(bytes(data))
        (damaged / "assets" / "a" / "one.png").unlink()
        problems = cb.verify_snapshot(damaged)
        check(len(problems) == 2, "changed byte and missing file both reported")
        try:
            cb.restore_snapshot(damaged, tmp / "nowhere", dest, port=0)
            check(False, "restore of a damaged snapshot must be refused")
        except cb.BackupError:
            check(not (tmp / "nowhere").exists(), "restore refuses a damaged snapshot and writes nothing")

        print("retention")
        for i in range(3):
            next_second()
            live.execute("INSERT INTO notes (body) VALUES (?)", (f"보존 {i}",))
            live.commit()
            cb.run_backup("auto", root, dest, keep=2)
        labels = [m["label"] for _p, m in cb.list_snapshots(dest)]
        check(labels.count("auto") == 2 and labels.count("manual") == 1, "2 newest automatic kept, manual never removed")
        check(snap1.is_dir() and not snap2.exists(), "oldest automatic snapshot removed")
        check(cb.verify_snapshot(snap1) == [], "removing a snapshot doesn't harm files it shared")

        print("restore over existing content")
        next_second()
        live.execute("DELETE FROM notes WHERE id > 5")
        live.commit()
        (root / "assets" / "a" / "one.png").unlink()
        (root / "assets" / "extra").mkdir()
        (root / "assets" / "extra" / "new.png").write_bytes(b"added later")
        os.chmod(locked, stat.S_IWRITE)
        locked.write_bytes(b"changed afterwards")
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        try:
            cb.restore_snapshot(snap1, root, dest, port=listener.getsockname()[1])
            check(False, "restore must be refused while the server port answers")
        except cb.BackupError:
            check(rows(db) == 5, "restore refused while the server is up; nothing changed")
        finally:
            listener.close()
        live.close()  # "server stopped"
        wal = root / "data" / (cb.DB_NAME + "-wal")
        wal.write_bytes(b"stale wal from the old database")
        outcome = cb.restore_snapshot(snap1, root, dest, port=0)
        check(rows(db) == 50, "DB is back to the snapshot's 50 rows")
        check(not wal.exists(), "old -wal removed with the old DB")
        check((root / "assets/a/one.png").is_file(), "deleted file is back")
        check(locked.read_bytes() == b"read only", "changed file is back to the snapshot's content")
        check(not (root / "assets" / "extra").exists(), "file that wasn't in the snapshot is gone, empty folder too")
        check((root / "data/log.md").read_text(encoding="utf-8") == "기록 1\n", "data/ file restored")
        before = dest / outcome["before"]
        check(before.name.endswith("_before-restore") and (before / "assets/extra/new.png").read_bytes() == b"added later",
              "what was there before is kept in a before-restore snapshot")
        check(rows(before / "data" / cb.DB_NAME) == 5, "before-restore snapshot has the DB as it was")

        print("restore on a PC with no content yet")
        fresh = tmp / "other-pc"
        fresh.mkdir()
        outcome = cb.restore_snapshot(snap1, fresh, dest, port=0)
        check(outcome["before"] is None and outcome["copied"] == 4, "all files copied, nothing to save first")
        check(rows(fresh / "data" / cb.DB_NAME) == 50, "DB arrived")
        check(not os.path.samefile(snap1 / "assets/b/two.bin", fresh / "assets/b/two.bin"), "restored files are independent copies")
        again = cb.run_backup("manual", fresh, tmp / "other-backups")
        check(again["files"] == 4, "the restored content can be backed up again")

        print("deep folders (paths past Windows' 260 characters)")
        deep = tmp / ("d" * 90) / ("e" * 90) / "backups"
        long_name = "n" * 80 + ".png"
        (fresh / "assets" / "a" / long_name).write_bytes(b"long name")
        made = cb.run_backup("manual", fresh, deep)
        deep_snap = deep / made["snapshot"]
        check(len(str(deep_snap / "data" / cb.DB_NAME)) > 260, "the test paths really are past the limit")
        check(made["warnings"] == [] and made["files"] == 5, "every file copied")
        check(cb.verify_snapshot(deep_snap) == [], "verify: clean")
        next_second()
        more = cb.run_backup("auto", fresh, deep)
        check(more["result"] == "unchanged", "the next automatic run finds it unchanged")
        far = tmp / ("r" * 90) / ("s" * 90) / "restored"
        outcome = cb.restore_snapshot(deep_snap, far, deep, port=0)
        check(outcome["copied"] == 5 and outcome["tables"] == {"notes": 50}, "restored into another deep folder")
        check(cb.latest_snapshot(deep)[0].name == deep_snap.name, "latest snapshot found")

        print("the server's automatic backup")
        cb.AUTO_START_DELAY_SECONDS = 0
        cb.AUTO_CHECK_SECONDS = 0.2
        auto_dest = tmp / "auto-backups"
        config = fresh / "data" / cb.CONFIG_NAME

        def configure(auto: bool) -> None:
            config.write_text(json.dumps({"dest": str(auto_dest), "keep": 3, "auto": auto}), encoding="utf-8")

        def wait_for(count: int) -> bool:
            deadline = time.time() + 10
            while time.time() < deadline:
                if len(cb.list_snapshots(auto_dest)) >= count:
                    return True
                time.sleep(0.1)
            return False

        configure(True)
        check(cb.load_config(fresh)["dest"] == str(auto_dest) and cb.load_config(fresh)["keep"] == 3, "settings read from data/backup_config.json")
        cb.start_auto_backup(fresh)
        check(wait_for(1) and cb.list_snapshots(auto_dest)[0][1]["label"] == "auto", "first snapshot made without being asked")
        time.sleep(1.5)
        (fresh / "data" / "log.md").write_text("바뀜", encoding="utf-8")
        time.sleep(1.0)
        check(len(cb.list_snapshots(auto_dest)) == 1, "no new snapshot before a day has passed, even with changes")
        failed = {"time": time.time() + 5, "ok": False, "error": "disk was unplugged"}
        (auto_dest / cb.LAST_RUN_NAME).write_text(json.dumps(failed), encoding="utf-8")
        check(wait_for(2), "after a failed run it tries again at the next check")
        configure(False)
        with cb._run_lock:
            pass
        time.sleep(0.5)
        (fresh / "data" / "log.md").write_text("또 바뀜", encoding="utf-8")
        failed["time"] = time.time() + 5
        (auto_dest / cb.LAST_RUN_NAME).write_text(json.dumps(failed), encoding="utf-8")
        time.sleep(1.5)
        check(len(cb.list_snapshots(auto_dest)) == 2, "switched off in the settings: nothing more is made")

        print("failure is recorded")
        empty = tmp / "empty"
        empty.mkdir()
        try:
            cb.run_backup("manual", empty, dest)
            check(False, "backup without a DB must fail")
        except cb.BackupError:
            last = cb.read_last_run(dest)
            check(last["ok"] is False and "DB" in last["error"], "last run says it failed and why")

        print("command line")
        check(cb.main(["--root", str(root), "--dest", str(dest), "list"]) == 0, "list")
        check(cb.main(["--root", str(root), "--dest", str(dest), "verify", snap1.name]) == 0, "verify by name")
        check(cb.main(["--root", str(root), "--dest", str(dest), "verify", "no-such"]) == 2, "unknown snapshot is an error")
        # backup.bat passes what it is given after the command: a second place, e.g. an external drive
        second = tmp / "external"
        check(cb.main(["backup", "--root", str(root), "--dest", str(second)]) == 0, "backup with the options after the command")
        check(len(cb.list_snapshots(second)) == 1, "it went to the place named there")
        check(cb.main(["--root", str(root), "verify", "--dest", str(second)]) == 0, "options before and after the command mix")
    finally:
        if live is not None:
            live.close()
        cb._rmtree(tmp)
    print(f"\nall backup tests passed ({passed} checks)")


if __name__ == "__main__":
    main()
