# Modify Certificate Requirements (Working Notes)

Last updated: 2026-04-16

## 1) Scope Split

The export template is treated as **two sections**:

1. Report body (main report content)
2. Appendix 1 (detail list section)

## 2) Report Body Requirements

The main report section includes editable fields for:

- Header/report-level content (company/title/media/counts/standard/report no.)
- Signature images (inspector/reviewer/approver)
- Four editable dates:
  - Inspector sign date
  - Reviewer sign date
  - Approver sign date
  - Company signoff date

Signoff company at the bottom is currently fixed (hardcoded, no DB).

## 3) Appendix 1 Requirements

Appendix 1 is treated as a separate part from the main report.

- It should be presented independently in field editing UI.
- It is not merged into the main report body field block.
- Multi-select data list is used as a collection view for appendix-related checking.

## 4) Non-DB Constraint

Mappings/config stay file-based (YAML/JS constants), not database-backed.
