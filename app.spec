# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['backend\\app.py'],
    pathex=[],
    binaries=[],
    datas=[('C:\\\\Users\\\\tyamashita\\\\AppData\\\\Local\\\\Packages\\\\PythonSoftwareFoundation.Python.3.11_qbz5n2kfra8p0\\\\LocalCache\\\\local-packages\\\\Python311\\\\site-packages\\\\en_core_web_sm', 'en_core_web_sm'), ('backend/data.db', 'backend')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='app',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
