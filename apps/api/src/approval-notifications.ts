import { database } from "./database.js";
import { sendTransactionalEmail } from "./email.js";

function html(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[character]!);
}

export async function notifyDriverApproved(email: string, driverName: string) {
  const web = (process.env.PUBLIC_WEB_BASE_URL ?? "https://mototaxi-atacames-admin.onrender.com").replace(/\/$/, "");
  const logo = `${web}/costa-go-emblem.png`;
  const privacy = `${web}/privacy.html`;
  const terms = `${web}/terms.html`;
  const safeName = html(driverName);
  return sendTransactionalEmail({
    to: email,
    subject: "Tu cuenta de conductor Costa-Go fue verificada",
    text: `Hola ${driverName}. Tu documentación fue verificada y tu perfil de conductor está apto para usar Costa-Go. Ingresa a la aplicación y activa Recibir viajes. Términos y condiciones: ${terms}. Política de privacidad: ${privacy}`,
    html: `<!doctype html><html><body style="margin:0;background:#f3f8fc;font-family:Arial,sans-serif;color:#0a2d46"><table role="presentation" width="100%"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 10px 30px rgba(3,43,73,.12)"><tr><td style="background:#032b49;padding:28px;text-align:center"><img src="${logo}" width="88" height="88" alt="Costa-Go" style="object-fit:contain"><h1 style="color:#fff;margin:12px 0 0;font-size:25px">¡Tu cuenta fue verificada!</h1></td></tr><tr><td style="padding:30px"><p style="font-size:17px">Hola <strong>${safeName}</strong>,</p><p>Revisamos tu documentación y tu perfil de conductor ya está <strong>apto para utilizar Costa-Go</strong>.</p><div style="background:#eaf7ff;border-left:4px solid #0aa9e8;padding:16px;border-radius:10px;margin:22px 0"><strong>Siguiente paso</strong><br>Abre la aplicación, ingresa en modo conductor y activa <em>Recibir viajes</em>.</div><p>Conduce de forma segura, verifica los datos del pasajero y utiliza los controles de estado durante cada recorrido.</p><p style="font-size:13px;color:#5d7180">Al usar Costa-Go aceptas sus <a href="${terms}" style="color:#087ccb">términos y condiciones de uso</a> y el tratamiento de datos descrito en nuestra <a href="${privacy}" style="color:#087ccb">política de privacidad</a>.</p><p style="margin-top:28px">Equipo Costa-Go<br><strong>Tu viaje, nuestra prioridad.</strong></p></td></tr></table></td></tr></table></body></html>`
  });
}

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
      from, to: recipients, subject: "Costa-Go: conductor pendiente de revisión",
      text: `${driverName} completó sus documentos. Ingresa al panel administrativo para revisarlos.`
    })
  });
  return { internal: true, email: response.ok };
}
