# Local vendor assets for offline mode

Place these files in this directory for Word preview in offline mode:

1. `jszip.min.js` (version 3.10.1)
2. `docx-preview.min.js` (version 0.3.6)
3. `docx-preview.css` (version 0.3.6)

When `OFFLINE_MODE=1`, frontend only loads local files under `/static/vendor/`.
If files are missing, OCR and report generation still work, but Word preview will be unavailable.
