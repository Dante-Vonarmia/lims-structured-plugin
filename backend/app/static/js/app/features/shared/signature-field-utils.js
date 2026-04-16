export function getSignatureRoleForField(fieldKey) {
  const key = String(fieldKey || "").trim();
  if (key === "inspector_sign_image") return "inspector";
  if (key === "reviewer_sign_image") return "reviewer";
  if (key === "approver_sign_image") return "approver";
  return "";
}

export function getSignatureImageUrlByValue(signatures, value) {
  const target = String(value || "").trim();
  if (!target) return "";
  const list = Array.isArray(signatures) ? signatures : [];
  const matched = list.find((item) => String((item && item.name) || "").trim() === target);
  return matched ? String((matched && matched.image_url) || "").trim() : "";
}

export function listSignatureNamesByRole(signatures, role) {
  const targetRole = String(role || "").trim();
  if (!targetRole) return [];
  const list = Array.isArray(signatures) ? signatures : [];
  return Array.from(new Set(list
    .filter((item) => {
      const itemRole = String((item && item.role) || "").trim();
      return !itemRole || itemRole === targetRole;
    })
    .map((item) => String((item && item.name) || "").trim())
    .filter(Boolean)));
}
