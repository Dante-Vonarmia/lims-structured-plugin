# Windows 11 One-Click Bundle (No Docker)

This folder provides a Windows packaging flow for a one-click runnable backend.

## Build On Windows 11

1. Open PowerShell in `backend/windows_bundle`.
2. Run:

```powershell
.\build_win11_bundle.ps1
```

3. Output will be created in `backend/release-win11`.

## Deliver To End User

Give the whole `release-win11` folder to the user.

User actions:

1. Double-click `run_lims_backend.bat`.
2. Browser opens `http://127.0.0.1:18081/` automatically.
3. To stop backend, double-click `stop_lims_backend.bat`.

## Notes

- This package includes Python runtime via PyInstaller output.
- Package is OS/arch specific (Windows only).
- Rebuild on the same target OS family you want to deliver.
