import { afterEach, describe, expect, it, vi } from "vitest";
import { renderCostaGoEmail, sendTransactionalEmail } from "./email.js";

describe("correo transaccional Costa-Go",()=>{
  afterEach(()=>{vi.unstubAllGlobals();delete process.env.RESEND_API_KEY;delete process.env.NOTIFICATION_FROM_EMAIL;});
  it("renderiza identidad, datos y acciones oficiales",()=>{
    const html=renderCostaGoEmail({title:"Membresía activada",greeting:"David & familia",badge:{label:"Activa",tone:"success"},rows:[{label:"Plan",value:"Mensual",emphasis:true}],primaryAction:{label:"Ver mi membresía",url:"costa-go://membership"}});
    expect(html).toContain('data-costa-go-email="true"');
    expect(html).toContain("/assets/costa-go-emblem.png");
    expect(html).toContain("Movilidad que conecta la costa");
    expect(html).toContain("David &amp; familia");
    expect(html).toContain("Ver mi membresía");
  });
  it("envuelve también los correos antiguos que solo enviaban texto",async()=>{
    process.env.RESEND_API_KEY="test";process.env.NOTIFICATION_FROM_EMAIL="Costa-Go <notificaciones@costa-go.com>";
    let requestBody='';
    vi.stubGlobal("fetch",async (_input:string|URL|Request,init?:RequestInit)=>{requestBody=String(init?.body??'');return {ok:true} as Response;});
    await sendTransactionalEmail({to:"test@example.com",subject:"Aviso · Costa-Go",text:"Contenido seguro"});
    const payload=JSON.parse(requestBody);
    expect(payload.html).toContain('data-costa-go-email="true"');expect(payload.html).toContain("Contenido seguro");
  });
});
