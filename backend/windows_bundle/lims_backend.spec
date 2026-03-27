# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

project_root = Path(__file__).resolve().parents[1]
entry_script = str(project_root / "run_backend.py")

hiddenimports = []
for mod in ("paddle", "paddleocr", "rapidocr_onnxruntime", "onnxruntime"):
    hiddenimports += collect_submodules(mod)

datas = []
for mod in ("paddle", "paddleocr", "rapidocr_onnxruntime", "onnxruntime"):
    datas += collect_data_files(mod)

datas += [
    (str(project_root / "app" / "static"), "app/static"),
    (str(project_root / "app" / "rules"), "app/rules"),
    (str(project_root / "templates"), "templates"),
]

binaries = []
for mod in ("paddle", "onnxruntime", "cv2"):
    binaries += collect_dynamic_libs(mod)


block_cipher = None


a = Analysis(
    [entry_script],
    pathex=[str(project_root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="lims-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="lims-backend",
)
