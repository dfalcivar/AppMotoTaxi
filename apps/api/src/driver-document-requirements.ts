import { database } from "./database.js";
import { notifyAdministratorsDriverReady } from "./approval-notifications.js";

// Driver approval only. Vehicle documents and fleet verification are independent.
// OPERATING_PERMIT remains a valid upload type, but is not mandatory.
export const requiredDriverDocuments = ["PROFILE_PHOTO", "IDENTIFICATION", "LICENSE", "REGISTRATION"] as const;

export async function refreshDriverApprovalState(driverId: string, driverName: string) {
  const sql = database();
  const [current] = await sql`select approval_status from drivers where user_id=${driverId}`;
  const [documents] = await sql`
    select count(distinct document_type)::int count from driver_documents
    where driver_id=${driverId} and status<>'SUSPENDED'
      and document_type in ${sql(requiredDriverDocuments)}
  `;
  const complete = Number(documents?.count ?? 0) === requiredDriverDocuments.length;
  const next = complete ? "PENDIENTE_REVISION" : "PENDIENTE_DOCUMENTOS";
  if (["APROBADO", "SUSPENDIDO"].includes(String(current?.approval_status))) return String(current?.approval_status);
  await sql`update drivers set approval_status=${next}, approval_observation=null,
    submitted_for_review_at=case when ${complete} then coalesce(submitted_for_review_at,now()) else null end,
    approval_updated_at=now() where user_id=${driverId}`;
  if (complete && current?.approval_status !== "PENDIENTE_REVISION") {
    void notifyAdministratorsDriverReady(driverId, driverName).catch(() => undefined);
  }
  return next;
}
