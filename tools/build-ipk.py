#!/usr/bin/env python3
"""Сборка ipk luci-theme-darkvibe без OpenWrt SDK (ручная упаковка, GNU tar)."""
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile

ARCH = sys.argv[1] if len(sys.argv) > 1 else "aarch64_cortex-a53"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # корень репы
OUT = os.path.join(ROOT, "dist")
PKG, VER, REL = "luci-theme-darkvibe", "1.4.1", "1"

DATA_MAP = [  # (источник, путь в data.tar.gz)
    ("htdocs/luci-static/darkvibe", "www/luci-static/darkvibe"),
    ("htdocs/luci-static/resources", "www/luci-static/resources"),
    ("ucode/template/themes/darkvibe", "usr/share/ucode/luci/template/themes/darkvibe"),
    ("luasrc/view/themes/darkvibe", "usr/lib/lua/luci/view/themes/darkvibe"),
    ("root/etc/config/darkvibe", "etc/config/darkvibe"),
    ("root/etc/uci-defaults/90_luci-theme-darkvibe", "etc/uci-defaults/90_luci-theme-darkvibe"),
    ("root/usr/share/luci/menu.d/luci-theme-darkvibe.json", "usr/share/luci/menu.d/luci-theme-darkvibe.json"),
    ("root/usr/share/rpcd/acl.d/luci-theme-darkvibe.json", "usr/share/rpcd/acl.d/luci-theme-darkvibe.json"),
]

CONTROL = f"""Package: {PKG}
Version: {VER}-{REL}
Depends: libc
Source: {PKG}
Section: luci
Priority: optional
Maintainer: free-net
Architecture: {ARCH}
Installed-Size: {{size}}
Description: DarkVibe Theme — темная тема LuCI в гамме free-net (графит + лайм)
"""

def add_parents(tf, arc, seen):
    parts = arc.split("/")
    for i in range(1, len(parts)):
        p = "/".join(parts[:i])
        if p and p not in seen:
            seen.add(p)
            ti = tarfile.TarInfo(p)
            ti.type = tarfile.DIRTYPE
            ti.mode = 0o755
            ti.mtime = 0
            tf.addfile(ti)

def add_tree(tf, src, arcbase, seen):
    if os.path.isfile(src):
        add_parents(tf, arcbase, seen)
        tf.add(src, arcbase, recursive=False)
        return
    # Явные записи всех каталогов (opkg не создаёт промежуточные сам)
    for dirpath, dirnames, filenames in os.walk(src):
        rel = os.path.relpath(dirpath, src)
        arc_dir = os.path.join(arcbase, rel) if rel != "." else arcbase
        add_parents(tf, arc_dir, seen)
        ti = tarfile.TarInfo(arc_dir)
        ti.type = tarfile.DIRTYPE
        ti.mode = 0o755
        ti.mtime = 0
        tf.addfile(ti)
        for name in filenames:
            full = os.path.join(dirpath, name)
            arc = os.path.join(arc_dir, name)
            tf.add(full, arc, recursive=False)

stage = tempfile.mkdtemp()
try:
    data_path = os.path.join(stage, "data.tar.gz")
    with tarfile.open(data_path, "w:gz", format=tarfile.GNU_FORMAT) as tf:
        seen_dirs = set()
        for src_rel, arc in DATA_MAP:
            add_tree(tf, os.path.join(ROOT, src_rel), arc, seen_dirs)
    size = os.path.getsize(data_path)

    ctrl_dir = os.path.join(stage, "control")
    os.makedirs(ctrl_dir)
    with open(os.path.join(ctrl_dir, "control"), "w") as f:
        f.write(CONTROL.format(size=size))
    ctrl_path = os.path.join(stage, "control.tar.gz")
    with tarfile.open(ctrl_path, "w:gz", format=tarfile.GNU_FORMAT) as tf:
        tf.add(os.path.join(ctrl_dir, "control"), "control", recursive=False)

    deb_path = os.path.join(stage, "debian-binary")
    with open(deb_path, "w") as f:
        f.write("2.0\n")

    os.makedirs(OUT, exist_ok=True)
    ipk = os.path.join(OUT, f"{PKG}_{VER}-{REL}_{ARCH}.ipk")
    if os.path.exists(ipk):
        os.remove(ipk)
    with tarfile.open(ipk, "w:gz", format=tarfile.GNU_FORMAT) as tf:
        tf.add(deb_path, "debian-binary", recursive=False)
        tf.add(ctrl_path, "control.tar.gz", recursive=False)
        tf.add(data_path, "data.tar.gz", recursive=False)

    print(f"Собрано: {ipk} ({os.path.getsize(ipk)//1024}K)")
finally:
    shutil.rmtree(stage, ignore_errors=True)
