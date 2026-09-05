import { database } from "./database.js";
import { renderCostaGoEmail, sendTransactionalEmail } from "./email.js";

export async function notifyDriverApproved(email: string, driverName: string) {
  const web = (process.env.PUBLIC_WEB_BASE_URL ?? "https://costa-go.com").replace(/\/$/, "");
  const privacy = `${web}/privacy.html`;
  const terms = `${web}/terms.html`;
  return sendTransactionalEmail({
    to: email,
    subject: "Tu cuenta de conductor Costa-Go fue verificada",
    text: `Hola ${driverName}. Tu documentación fue verificada y tu perfil de conductor está apto para usar Costa-Go. Ingresa a la aplicación y activa Recibir viajes. Términos y condiciones: ${terms}. Política de privacidad: ${privacy}`,
    html: renderCostaGoEmail({title:'¡Tu cuenta fue verificada!',greeting:driverName,
      lead:'Revisamos tu documentación y tu perfil de conductor ya está apto para utilizar Costa-Go.',
      badge:{label:'Conductor aprobado',tone:'success'},
      notice:{title:'Siguiente paso',text:'Abre la aplicación, ingresa en modo conductor y activa “Recibir viajes”.',tone:'info'},
      primaryAction:{label:'Abrir Costa-Go',url:'costa-go://membership'},
      bodyHtml:`<p style="color:#53657d;font-size:13px;line-height:1.6">Al usar Costa-Go aceptas sus <a href="${terms}" style="color:#087ccb">términos y condiciones</a> y nuestra <a href="${privacy}" style="color:#087ccb">política de privacidad</a>.</p>`})
  });
}

export async function notifyAdministratorsDriverReady(driverId: string, driverName: string) {
  const sql = database();
  const web = (process.env.PUBLIC_WEB_BASE_URL ?? "https://costa-go.com").replace(/\/$/, "");
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
  const results=await Promise.all(recipients.map(to=>sendTransactionalEmail({
    to,subject:"Costa-Go: conductor pendiente de revisión",
    text:`${driverName} completó sus documentos. Ingresa al panel administrativo para revisarlos.`,
    html:renderCostaGoEmail({title:'Conductor pendiente de revisión',lead:`${driverName} completó sus documentos y espera aprobación.`,primaryAction:{label:'Abrir panel Costa-Go',url:web}})
  })));
  return { internal: true, email: results.every(Boolean) };
}
