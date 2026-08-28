type ApprovalDocuments = {
  approvedDocuments?: number;
  approvedRequiredDocuments?: number;
  requiredDocumentCount?: number;
};

export function driverDocumentProgress(driver: ApprovalDocuments) {
  // Preserve the old five-document gate if the panel reaches an older API.
  // Never use the total (which includes optional files) against a four-file gate.
  const hasRequirements = Number.isInteger(driver.requiredDocumentCount) && driver.requiredDocumentCount! > 0;
  const required = hasRequirements ? driver.requiredDocumentCount! : 5;
  const approved = (hasRequirements ? driver.approvedRequiredDocuments : driver.approvedDocuments) ?? 0;
  return { label: `${approved}/${required} obligatorios aprobados`, complete: approved === required };
}
