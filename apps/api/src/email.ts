export type CostaGoEmailTone = "info" | "success" | "warning" | "danger";

export interface CostaGoEmailRow { label: string; value: string; emphasis?: boolean; }
export interface CostaGoEmailOptions {
  title: string; preheader?: string; greeting?: string; lead?: string; bodyHtml?: string;
  badge?: { label: string; tone?: CostaGoEmailTone }; rows?: CostaGoEmailRow[];
  primaryAction?: { label: string; url: string }; secondaryAction?: { label: string; url: string };
  notice?: { title?: string; text: string; tone?: CostaGoEmailTone };
}

export function escapeEmailHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]!);
}

function publicWebBase(): string { return (process.env.PUBLIC_WEB_BASE_URL ?? "https://costa-go.com").replace(/\/$/, ""); }
function palette(tone: CostaGoEmailTone = "info") {
  return { info:{color:"#075dcc",soft:"#eaf3ff",border:"#c9ddfb"}, success:{color:"#14833b",soft:"#eaf8ef",border:"#bde9ca"}, warning:{color:"#a55b00",soft:"#fff5df",border:"#f3d49b"}, danger:{color:"#c52d4c",soft:"#fff0f3",border:"#f4c7d1"} }[tone];
}
function safeUrl(url: string): string { const value=url.trim(); return /^(https?:\/\/|costa-go:\/\/)/i.test(value)?escapeEmailHtml(value):"#"; }

export function renderCostaGoEmail(options: CostaGoEmailOptions): string {
  const logo=`${publicWebBase()}/assets/costa-go-emblem.png`, badge=options.badge?palette(options.badge.tone):undefined, notice=options.notice?palette(options.notice.tone):undefined;
  const rows=(options.rows??[]).map(row=>`<tr><td style="padding:11px 16px;border-bottom:1px solid #e5edf7;color:#53657d;font-size:14px">${escapeEmailHtml(row.label)}</td><td align="right" style="padding:11px 16px;border-bottom:1px solid #e5edf7;color:${row.emphasis?"#075dcc":"#10233f"};font-size:14px;font-weight:${row.emphasis?"800":"600"}">${escapeEmailHtml(row.value)}</td></tr>`).join("");
  const action=(value:{label:string;url:string},outlined=false)=>`<a href="${safeUrl(value.url)}" style="display:inline-block;margin:6px;padding:13px 22px;border-radius:9px;border:1px solid #0867db;background:${outlined?"#fff":"#0867db"};color:${outlined?"#0867db":"#fff"};font-size:15px;font-weight:700;text-decoration:none">${escapeEmailHtml(value.label)}</a>`;
  return `<!doctype html><html lang="es" data-costa-go-email="true"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3f7fc;font-family:Arial,Helvetica,sans-serif;color:#10233f"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeEmailHtml(options.preheader??options.lead??options.title)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fc"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fff;border:1px solid #dce6f2;border-radius:18px;overflow:hidden;box-shadow:0 12px 34px rgba(12,52,92,.10)"><tr><td style="padding:24px 30px;background:linear-gradient(135deg,#063e9b,#0878ed);color:#fff"><table role="presentation" width="100%"><tr><td width="66"><img src="${logo}" width="52" height="52" alt="Costa-Go" style="display:block;border-radius:50%;background:#fff;object-fit:contain"></td><td><div style="font-size:28px;font-weight:800">Costa-Go</div><div style="font-size:14px;opacity:.95">Movilidad que conecta la costa</div></td></tr></table></td></tr><tr><td style="padding:30px 32px"><h1 style="margin:0;text-align:center;color:#08214a;font-size:27px;line-height:1.2">${escapeEmailHtml(options.title)}</h1>${options.badge?`<div style="text-align:center;margin:12px 0 4px"><span style="display:inline-block;padding:6px 13px;border-radius:999px;background:${badge!.soft};border:1px solid ${badge!.border};color:${badge!.color};font-size:13px;font-weight:700">${escapeEmailHtml(options.badge.label)}</span></div>`:""}${options.greeting?`<p style="margin:24px 0 8px;font-size:16px">Hola <strong>${escapeEmailHtml(options.greeting)}</strong>,</p>`:""}${options.lead?`<p style="margin:8px 0 20px;color:#314762;font-size:16px;line-height:1.6">${escapeEmailHtml(options.lead)}</p>`:""}${options.bodyHtml??""}${rows?`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;border:1px solid #ccdcf1;border-radius:10px;border-collapse:separate;overflow:hidden"><tr><td colspan="2" style="padding:12px 16px;background:#f3f8ff;color:#0b4fa8;font-weight:800">Resumen</td></tr>${rows}</table>`:""}${options.notice?`<table role="presentation" width="100%" style="margin:18px 0;background:${notice!.soft};border:1px solid ${notice!.border};border-radius:10px"><tr><td style="padding:14px 16px;color:${notice!.color};line-height:1.5"><strong>${escapeEmailHtml(options.notice.title??"Información importante")}</strong><br><span style="color:#40546e">${escapeEmailHtml(options.notice.text)}</span></td></tr></table>`:""}${options.primaryAction||options.secondaryAction?`<div style="text-align:center;margin:20px 0 4px">${options.primaryAction?action(options.primaryAction):""}${options.secondaryAction?action(options.secondaryAction,true):""}</div>`:""}</td></tr><tr><td style="padding:20px 30px;border-top:1px solid #e3ebf5;text-align:center;color:#6b7c91;font-size:12px;line-height:1.6">Este correo fue enviado automáticamente. Por favor, no respondas.<br><strong style="color:#075dcc">Costa-Go</strong> · Movilidad que conecta la costa</td></tr></table></td></tr></table></body></html>`;
}

function brandedHtml(input:{subject:string;text:string;html?:string}):string{
  if(input.html?.includes('data-costa-go-email="true"'))return input.html;
  const content=input.html??input.text.split(/\r?\n/).filter(Boolean).map(line=>`<p style="margin:0 0 12px;color:#314762;font-size:16px;line-height:1.6">${escapeEmailHtml(line)}</p>`).join("");
  return renderCostaGoEmail({title:input.subject.replace(/\s*[·|—-]\s*Costa-Go\s*$/i,""),bodyHtml:content});
}

export async function sendTransactionalEmail(input:{to:string;subject:string;text:string;html?:string}):Promise<boolean>{
  const apiKey=process.env.RESEND_API_KEY,from=process.env.NOTIFICATION_FROM_EMAIL;
  if(!apiKey||!from)return false;
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({...input,html:brandedHtml(input),from})});
  return response.ok;
}
