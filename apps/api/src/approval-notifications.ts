import { database } from "./database.js";

export async function notifyAdministratorsDriverReady(driverId: string, driverName: string) {
  const sql = database();
  const [settings] = await sql`
    select admin_emails as "adminEmails", email_enabled as "emailEnabled",
      internal_enabled as "internalEnabled"
    from driver_approval_notification_settings where id=1
  `;
  if (settings?.internalEnabled !== false) await sql`
    insert into admin_notifications (type,title,body,entity_type,entity_id)
    values ('DRIVER_PENDING_REVIEW','Conductor pendiente de revisión',
      ${`${driverName} completó sus documentos y espera aprobación.`},'DRIVER',${driverId})
  `;
  const recipients = Array.isArray(settings?.adminEmails)
    ? settings.adminEmails.filter((email): email is string => typeof email === "string" && email.includes("@"))
    : [];
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATION_FROM_EMAIL;
  if (!settings?.emailEnabled || !apiKey || !from || !recipients.length) return { internal: true, email: false };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: recipients, subject: "AtacamesGo: conductor pendiente de revisión",
      text: `${driverName} completó sus documentos. Ingresa al panel administrativo para revisarlos.`
    })
  });
  return { internal: true, email: response.ok };
}
