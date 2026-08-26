import { useEffect, useMemo, useState } from "react";
import { apiFetch, apiUrl } from "./api.js";
import { usePanelDialog } from "./panel-dialog.js";
import "./memberships.css";
import "./memberships-responsive.css";

type Props = { token: string; permissions: string[] };
type PlanEditorState = {
  mode: "create" | "edit";
  source?: any;
  draft: {
    name: string;
    code: string;
    periodUnit: "DAY" | "MONTH" | "QUARTER" | "YEAR";
    periodCount: number;
    baseAmount: number;
    includedTrips: number;
    maxRenewalAmount: number;
    extraTripSharePercent: number;
  };
};
type PlanDeactivationState = { plan: any; reason: string };
const money = (value: unknown, currency = "USD") => new Intl.NumberFormat("es-EC", { style: "currency", currency }).format(Number(value ?? 0));
const date = (value: unknown) => value ? new Date(String(value)).toLocaleString("es-EC") : "Sin fecha";
const businessDate = (value: string) => new Intl.DateTimeFormat("es-EC", { dateStyle:"full", timeZone:"America/Guayaquil" }).format(new Date(`${value}T12:00:00-05:00`));
const membershipLabels: Record<string,string> = {
  PENDING:"Pendiente de activación",ACTIVE:"Activa",EXPIRING:"Próxima a vencer",GRACE_PERIOD:"En gracia",
  PAYMENT_DUE:"Pago pendiente",SUSPENSION_PENDING_ACTIVE_TRIP:"Suspensión al finalizar viaje",
  SUSPENDED_NON_PAYMENT:"Vencida",SUSPENDED:"Suspendida",CLOSED:"Ciclo cerrado"
};
const planLabels: Record<string,string> = { MONTHLY:"Mensual",QUARTERLY:"Trimestral",ANNUAL:"Anual" };
const paymentMethodLabels: Record<string,string> = { CASH:"Efectivo",DEUNA:"De Una",BANK_TRANSFER:"Transferencia bancaria",COURTESY:"Cortesía" };
const operationalStatusLabels: Record<string,string> = {
  ACTIVE:"Activo",INACTIVE:"Inactivo",SUSPENDED:"Suspendido",DRAFT:"Borrador",PAUSED:"Pausada",FINISHED:"Finalizada",
  PENDING_SETTLEMENT:"Pendiente de liquidación",SETTLED:"Liquidado",VERIFIED:"Verificado",CONFIRMED:"Confirmado",PENDING:"Pendiente"
};
const scopeLabels: Record<string,string> = { ALL:"Todos",COOPERATIVE:"Cooperativa",DRIVER:"Conductor" };
const navigationProviderOptions = [
  { value:"MAP_ONLY", label:"Mapa interno de Costa-Go", description:"Muestra la ruta dentro de Costa-Go, sin navegación giro a giro." },
  { value:"EXTERNAL_MAPS", label:"Abrir Google Maps", description:"Abre la navegación instalada en el teléfono del conductor." },
  { value:"NAVIGATION_SDK", label:"Navegación integrada", description:"Usa navegación giro a giro dentro de Costa-Go cuando esté habilitada." }
];
const labelFor = (labels:Record<string,string>,value:unknown) => labels[String(value)] ?? String(value ?? "—").replaceAll("_"," ");
const scheduleDays=[{value:1,label:"Lunes"},{value:2,label:"Martes"},{value:3,label:"Miércoles"},{value:4,label:"Jueves"},{value:5,label:"Viernes"},{value:6,label:"Sábado"},{value:0,label:"Domingo"}];
const scheduleValue=(point:any,day:number)=>{const value=point.schedules?.find((item:any)=>Number(item.dayOfWeek)===day);return {closed:!value||Boolean(value.closed),opensAt:String(value?.opensAt??"08:00").slice(0,5),closesAt:String(value?.closesAt??"18:00").slice(0,5)};};
function schedulesFromValues(values:Record<string,unknown>){return scheduleDays.map(day=>{const schedule=values[`schedule${day.value}`] as {closed:boolean;opensAt:string;closesAt:string};return schedule.closed?{dayOfWeek:day.value,closed:true,opensAt:null,closesAt:null}:{dayOfWeek:day.value,closed:false,opensAt:schedule.opensAt,closesAt:schedule.closesAt};});}

function Card({label,value,tone=""}:{label:string;value:unknown;tone?:string}) {
  return <article className={`membership-stat ${tone}`}><span>{label}</span><strong>{String(value ?? 0)}</strong></article>;
}

function CollectorPortal({token}:Pick<Props,"token">) {
  const dialog=usePanelDialog();
  const [profile,setProfile]=useState<any>({points:[]});
  const [payments,setPayments]=useState<any[]>([]);
  const [closures,setClosures]=useState<any[]>([]);
  const [lookup,setLookup]=useState(()=>new URLSearchParams(window.location.search).get("paymentToken")??"");
  const [order,setOrder]=useState<any>();
  const [orderMatches,setOrderMatches]=useState<any[]>([]);
  const [pointId,setPointId]=useState("");
  const [closingDate,setClosingDate]=useState("");
  const [method,setMethod]=useState("CASH");
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const searchValue=()=>lookup.trim();
  const pointPayments=useMemo(()=>payments.filter(item=>item.collectionPointId===pointId),[payments,pointId]);
  const pendingDates=useMemo(()=>Array.from(new Set(pointPayments.map(item=>String(item.businessDate)))).sort(),[pointPayments]);
  const selectedPayments=useMemo(()=>pointPayments.filter(item=>item.businessDate===closingDate),[pointPayments,closingDate]);
  const selectedTotal=useMemo(()=>selectedPayments.reduce((sum,item)=>sum+Number(item.amount),0),[selectedPayments]);
  async function load(){try{const [me,pending,history]=await Promise.all([apiFetch<any>("/v1/collector/me",token),apiFetch<any[]>("/v1/collector/payments/pending-closure",token),apiFetch<any[]>("/v1/collector/closures",token)]);setProfile(me);setPayments(pending);setClosures(history.filter(item=>Number(item.grossAmount)>0));if(!pointId&&me.points?.[0])setPointId(me.points[0].id);}catch(reason){setError(reason instanceof Error?reason.message:"No se pudo cargar el portal.");}}
  useEffect(()=>{void load();if(searchValue().length>=3)void findOrder();},[token]);
  useEffect(()=>{if(!pendingDates.includes(closingDate))setClosingDate(pendingDates[0]??"");},[pendingDates,closingDate]);
  async function findOrder(){setBusy(true);setError("");setMessage("");setOrder(undefined);try{const matches=await apiFetch<any[]>(`/v1/collector/payment-orders/search?query=${encodeURIComponent(searchValue())}`,token);setOrderMatches(matches);if(matches.length===1)setOrder(matches[0]);else if(matches.length===0)setError("No encontramos una orden vigente con esos datos.");}catch(reason){setOrderMatches([]);setError(reason instanceof Error?reason.message:"No se pudo consultar la orden.");}finally{setBusy(false);}}
  async function confirm(){if(!order||!pointId)return;setBusy(true);setError("");try{await apiFetch(`/v1/collector/payment-orders/${order.id}/confirm`,token,{method:"POST",body:JSON.stringify({method,collectionPointId:pointId,idempotencyKey:`collector-${order.id}-${method}`})});setMessage("Pago confirmado. La membresía ya está activa.");setOrder(undefined);setOrderMatches([]);setLookup("");await load();}catch(reason){setError(reason instanceof Error?reason.message:"No se pudo confirmar el pago.");}finally{setBusy(false);}}
  async function closeCash(){if(!pointId||!closingDate||!selectedPayments.length)return;const confirmation=await dialog.open({title:"Confirmar cierre de caja",description:`Se cerrará la jornada ${businessDate(closingDate)} con ${selectedPayments.length} pago(s) por ${money(selectedTotal)}. Los pagos no podrán incluirse en otro cierre.`,confirmLabel:"Cerrar jornada"});if(!confirmation)return;setBusy(true);setError("");setMessage("");try{const result=await apiFetch<any>("/v1/collector/closures",token,{method:"POST",body:JSON.stringify({collectionPointId:pointId,businessDate:closingDate,notes:"Cierre generado desde el portal de recaudación"})});setMessage(`Cierre de ${businessDate(result.businessDate)} creado por ${money(result.grossAmount)} con ${result.payments} pago(s).`);await load();}catch(reason){setError(reason instanceof Error?reason.message:"No se pudo crear el cierre.");await load();}finally{setBusy(false);}}
  return <div className="membership-admin collector-portal">
    <section className="card membership-hero"><div><span className="eyebrow">PORTAL DE RECAUDACIÓN</span><h2>Confirmar membresías</h2><p>Valida el QR o código del conductor. No modifica perfiles, documentos ni viajes.</p></div><button className="secondary" onClick={()=>void load()}>Actualizar</button></section>
    {error&&<div className="alert error">{error}</div>}{message&&<div className="alert success">{message}</div>}
    <section className="card"><h2>Buscar orden</h2><p className="note">Escanea el QR o busca por código de orden, placa o correo del conductor.</p><div className="membership-toolbar"><label>QR, código, placa o correo<input value={lookup} onChange={event=>setLookup(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"&&searchValue().length>=3)void findOrder();}} placeholder="Ej. ABC123, correo@dominio.com o código"/></label><label>Punto<select value={pointId} onChange={event=>setPointId(event.target.value)}>{profile.points?.map((point:any)=><option key={point.id} value={point.id}>{point.name}</option>)}</select></label><button className="primary" disabled={busy||searchValue().length<3} onClick={()=>void findOrder()}>Buscar</button></div>{orderMatches.length>1&&<div className="collector-order-results"><h3>Selecciona la orden correcta</h3>{orderMatches.map(match=><button key={match.id} type="button" onClick={()=>setOrder(match)}><span><strong>{match.driver}</strong><small>{match.email} · placa {match.vehicle??"sin registrar"}</small></span><span>{match.shortCode}<small>{money(match.amount,match.currency)}</small></span></button>)}</div>}{order&&<div className="collector-order"><h3>{order.driver}</h3><p>{order.email} · placa <strong>{order.vehicle??"sin registrar"}</strong></p><p>{order.plan?.name} · <strong>{money(order.amount,order.currency)}</strong></p><p>Código {order.shortCode} · vence {date(order.expiresAt)}</p><label>Método<select value={method} onChange={event=>setMethod(event.target.value)}><option value="CASH">Efectivo</option><option value="DEUNA">De Una</option><option value="BANK_TRANSFER">Transferencia verificada en punto</option></select></label><button className="primary" disabled={busy||order.status!=="PENDING"} onClick={()=>void confirm()}>{order.status==="PENDING"?"Confirmar pago":"Orden no disponible para cobro"}</button></div>}</section>
    <section className="card"><div className="membership-toolbar"><div><h2>Recaudación pendiente de cierre</h2><p>{selectedPayments.length} pago(s) · {money(selectedTotal)}</p></div>{pendingDates.length>0&&<label>Jornada pendiente<select value={closingDate} onChange={event=>setClosingDate(event.target.value)}>{pendingDates.map(value=><option key={value} value={value}>{businessDate(value)}</option>)}</select></label>}<button className="secondary" disabled={busy||!pointId||!closingDate||!selectedPayments.length} onClick={()=>void closeCash()}>{selectedPayments.length?"Cerrar jornada":"Sin valores pendientes"}</button></div>{selectedPayments.length?<div className="table-wrap"><table><thead><tr><th>Hora</th><th>Conductor</th><th>Método</th><th>Monto</th><th>Estado</th></tr></thead><tbody>{selectedPayments.map(item=><tr key={item.id}><td>{date(item.confirmedAt)}</td><td>{item.driver}</td><td>{labelFor(paymentMethodLabels,item.method)}</td><td>{money(item.amount,item.currency)}</td><td>{labelFor(operationalStatusLabels,item.settlementStatus)}</td></tr>)}</tbody></table></div>:<p className="empty">No hay nada que cerrar. La jornada ya fue cerrada o todavía no existen cobros pendientes.</p>}</section>
    <section className="card"><h2>Últimos cierres</h2><div className="table-wrap"><table><thead><tr><th>Período</th><th>Punto</th><th>Total</th><th>Estado</th></tr></thead><tbody>{closures.map(item=><tr key={item.id}><td>{date(item.periodEnd)}</td><td>{item.point}</td><td>{money(item.netAmount)}</td><td>{labelFor(operationalStatusLabels,item.status)}</td></tr>)}</tbody></table></div>{!closures.length&&<p className="empty">Aún no existen cierres con recaudación.</p>}</section>
    {dialog.modal}
  </div>;
}

export function MembershipAdmin(props:Props) {
  const collectorOnly=props.permissions.includes("payments:collect")&&!props.permissions.includes("memberships:manage")&&!props.permissions.includes("payments:transfer_review");
  return collectorOnly?<CollectorPortal token={props.token}/>:<MembershipManagement {...props}/>;
}

function MembershipManagement({token,permissions}:Props) {
  const can=(permission:string)=>permissions.includes(permission);
  const dialog=usePanelDialog();
  const [summary,setSummary]=useState<any>();
  const [memberships,setMemberships]=useState<any>({items:[]});
  const [plans,setPlans]=useState<any[]>([]);
  const [settings,setSettings]=useState<any>();
  const [paymentAccount,setPaymentAccount]=useState<any>();
  const [pendingPayments,setPendingPayments]=useState<any[]>([]);
  const [usage,setUsage]=useState<any>();
  const [collectionData,setCollectionData]=useState<any>({points:[],collectors:[]});
  const [closures,setClosures]=useState<any[]>([]);
  const [gracePolicies,setGracePolicies]=useState<any[]>([]);
  const [filters,setFilters]=useState({status:"",search:""});
  const [tab,setTab]=useState<"memberships"|"plans"|"payments"|"settings"|"import"|"collection"|"grace">("memberships");
  const [error,setError]=useState(""); const [success,setSuccess]=useState(""); const [busy,setBusy]=useState(false);
  const [importPreview,setImportPreview]=useState<any>();
  const [planEditor,setPlanEditor]=useState<PlanEditorState|null>(null);
  const [planDeactivation,setPlanDeactivation]=useState<PlanDeactivationState|null>(null);
  const currentPlans=useMemo(()=>plans.filter(plan=>plan.current===true),[plans]);
  const historicalPlans=useMemo(()=>plans.filter(plan=>plan.current!==true),[plans]);

  async function load() {
    setError("");
    try {
      const query=new URLSearchParams({page:"1",limit:"100"});if(filters.status)query.set("status",filters.status);if(filters.search)query.set("search",filters.search);
      const calls:Promise<any>[]=[apiFetch("/v1/admin/memberships/dashboard",token),apiFetch(`/v1/admin/memberships?${query}`,token),apiFetch("/v1/admin/membership-plans",token)];
      const [nextSummary,nextMemberships,nextPlans]=await Promise.all(calls);
      setSummary(nextSummary);setMemberships(nextMemberships);setPlans(nextPlans);
      if(can("settings:view")){
        setSettings(await apiFetch("/v1/admin/platform-settings",token));
        const accountResult=await apiFetch<any>("/v1/admin/membership-payment-account",token);
        setPaymentAccount(accountResult.account??{bankName:"",accountType:"",accountIdentifier:"",holderName:"",holderIdentification:"",supportEmail:"",enabled:false});
      }
      if(can("payments:transfer_review"))setPendingPayments(await apiFetch("/v1/admin/membership-payments/pending",token));
      if(can("api_usage:view"))setUsage(await apiFetch("/v1/admin/api-usage",token));
      if(can("collection_points:manage"))setCollectionData(await apiFetch("/v1/admin/collection-points",token));
      if(can("cash_closures:review"))setClosures(await apiFetch("/v1/admin/collection-closures",token));
      if(can("memberships:view"))setGracePolicies(await apiFetch("/v1/admin/membership-grace-policies",token));
    } catch(reason){setError(reason instanceof Error?reason.message:"No se pudo cargar membresías.");}
  }
  useEffect(()=>{void load();},[token,filters.status]);

  async function action(driverId:string,action:string) {
    const values=await dialog.open({title:action==="SUSPEND"?"Suspender membresía":"Confirmar acción",description:"La decisión quedará registrada en la auditoría de Costa-Go.",confirmLabel:action==="SUSPEND"?"Suspender":"Confirmar",dangerous:action==="SUSPEND",fields:[{name:"reason",label:"Motivo obligatorio",type:"textarea",initialValue:"Gestión autorizada desde el panel Costa-Go",required:true,minLength:5}]});
    if(!values)return;const reason=String(values.reason).trim();
    setBusy(true);setError("");
    try{await apiFetch(`/v1/admin/memberships/${driverId}/action`,token,{method:"POST",body:JSON.stringify({action,reason})});setSuccess("Membresía actualizada y auditada.");await load();}
    catch(reason){setError(reason instanceof Error?reason.message:"No se pudo actualizar.");}finally{setBusy(false);}
  }

  async function grantGrace(driverId:string){const values=await dialog.open({title:"Conceder días de gracia",description:"El conductor podrá recibir solicitudes durante el período indicado.",confirmLabel:"Conceder gracia",fields:[{name:"days",label:"Días de gracia",type:"number",initialValue:Number(settings?.membershipGraceDays??2),required:true,min:1,max:90,step:1},{name:"reason",label:"Motivo obligatorio",type:"textarea",required:true,minLength:5}]});if(!values)return;const days=Number(values.days);const reason=String(values.reason).trim();setBusy(true);try{await apiFetch(`/v1/admin/memberships/${driverId}/action`,token,{method:"POST",body:JSON.stringify({action:"GRANT_GRACE",days,allowsTrips:true,reason})});setSuccess(`Se concedieron ${days} día(s) de gracia con auditoría.`);await load();}catch(reason){setError(reason instanceof Error?reason.message:"No se pudo aplicar la gracia.");}finally{setBusy(false);}}
  async function adjustMembership(driverId:string){const values=await dialog.open({title:"Ajustar ciclo de membresía",description:"Usa un valor negativo para descuento o positivo para recargo. El historial original se conservará.",confirmLabel:"Aplicar ajuste",fields:[{name:"amount",label:"Ajuste en USD",type:"number",initialValue:-1,required:true,step:.01},{name:"reason",label:"Motivo obligatorio",type:"textarea",required:true,minLength:5}]});if(!values)return;const amount=Number(values.amount);if(amount===0){setError("El ajuste no puede ser cero.");return;}const reason=String(values.reason).trim();setBusy(true);try{await apiFetch(`/v1/admin/memberships/${driverId}/action`,token,{method:"POST",body:JSON.stringify({action:"ADJUST",amount,adjustmentType:amount<0?"DISCOUNT":"POSITIVE",reason})});setSuccess("Ajuste aplicado al ciclo sin modificar su historial.");await load();}catch(reason){setError(reason instanceof Error?reason.message:"No se pudo ajustar.");}finally{setBusy(false);}}

  async function courtesyRenew(driverId:string){
    const enabledPlans=plans.filter(plan=>plan.enabled!==false);
    if(!enabledPlans.length){setError("No existen planes activos para aplicar la cortesía.");return;}
    const values=await dialog.open({title:"Activar membresía de cortesía",description:"No se registrará ingreso y la operación quedará auditada.",confirmLabel:"Activar cortesía",fields:[{name:"planId",label:"Plan",type:"select",initialValue:String(enabledPlans[0].id),required:true,options:enabledPlans.map(plan=>({value:String(plan.id),label:`${plan.name} · ${money(plan.baseAmount,plan.currency)}`}))},{name:"reason",label:"Motivo obligatorio",type:"textarea",required:true,minLength:5}]});
    if(!values)return;const plan=enabledPlans.find(item=>String(item.id)===String(values.planId));if(!plan)return;const reason=String(values.reason).trim();
    setBusy(true);setError("");
    try{await apiFetch(`/v1/admin/memberships/${driverId}/action`,token,{method:"POST",body:JSON.stringify({action:"COURTESY_RENEW",planId:plan.id,reason})});setSuccess(`Membresía ${plan.name} activada como cortesía y registrada en auditoría.`);await load();}
    catch(reason){setError(reason instanceof Error?reason.message:"No se pudo aplicar la cortesía.");}finally{setBusy(false);}
  }

  const planDurationDays=(unit:PlanEditorState["draft"]["periodUnit"],count:number)=>unit==="DAY"?count:unit==="MONTH"?count*30:unit==="QUARTER"?count*90:count*365;
  const inferPlanPeriod=(plan:any):Pick<PlanEditorState["draft"],"periodUnit"|"periodCount">=>{
    if(["DAY","MONTH","QUARTER","YEAR"].includes(plan?.periodUnit)&&Number.isInteger(Number(plan?.periodCount)))return {periodUnit:plan.periodUnit,periodCount:Number(plan.periodCount)};
    const days=Number(plan?.durationDays??30);
    if(days%365===0)return {periodUnit:"YEAR",periodCount:days/365};
    if(days%90===0)return {periodUnit:"QUARTER",periodCount:days/90};
    if(days%30===0)return {periodUnit:"MONTH",periodCount:days/30};
    return {periodUnit:"DAY",periodCount:days};
  };
  function createPlan(){
    setError("");
    setPlanEditor({mode:"create",draft:{name:"",code:"",periodUnit:"MONTH",periodCount:1,baseAmount:0,includedTrips:0,maxRenewalAmount:0,extraTripSharePercent:Number(settings?.membershipExtraTripSharePercent??40)}});
  }
  function editPlan(plan:any){
    setError("");
    setPlanEditor({mode:"edit",source:plan,draft:{name:String(plan.name??""),code:String(plan.code??""),...inferPlanPeriod(plan),baseAmount:Number(plan.baseAmount??0),includedTrips:Number(plan.includedTrips??0),maxRenewalAmount:Number(plan.maxRenewalAmount??0),extraTripSharePercent:Number(plan.extraTripSharePercent??settings?.membershipExtraTripSharePercent??40)}});
  }
  async function submitPlan(){
    if(!planEditor)return;
    const draft=planEditor.draft;
    const name=draft.name.trim();
    const code=(draft.code.trim()||name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g,"_").replace(/^_+|_+$/g,"")).toUpperCase();
    const durationDays=planDurationDays(draft.periodUnit,draft.periodCount);
    if(name.length<2||!(/^[A-Z0-9_]{2,40}$/).test(code)||!Number.isInteger(draft.periodCount)||draft.periodCount<1||draft.periodCount>24||durationDays>730||!Number.isFinite(draft.baseAmount)||draft.baseAmount<0||!Number.isInteger(draft.includedTrips)||draft.includedTrips<0||!Number.isFinite(draft.maxRenewalAmount)||draft.maxRenewalAmount<draft.baseAmount||!Number.isFinite(draft.extraTripSharePercent)||draft.extraTripSharePercent<0||draft.extraTripSharePercent>100){setError("Revisa el nombre, la duración, los valores y los viajes incluidos del plan.");return;}
    const values={name,periodUnit:draft.periodUnit,periodCount:draft.periodCount,durationDays,baseAmount:draft.baseAmount,currency:"USD",includedTrips:draft.includedTrips,maxRenewalAmount:draft.maxRenewalAmount,extraTripSharePercent:draft.extraTripSharePercent};
    setBusy(true);setError("");
    try{
      if(planEditor.mode==="create"){
        await apiFetch("/v1/admin/membership-plans",token,{method:"POST",body:JSON.stringify({...values,code,enabled:true})});
        setSuccess("Plan creado. Los ciclos existentes conservan sus condiciones.");
      }else{
        await apiFetch(`/v1/admin/membership-plans/${planEditor.source.id}/versions`,token,{method:"POST",body:JSON.stringify(values)});
        setSuccess(`Nueva versión de ${name} publicada. Las membresías vigentes no fueron modificadas.`);
      }
      setPlanEditor(null);await load();
    }catch(reason){setError(reason instanceof Error?reason.message:"No se pudo guardar el plan.");}finally{setBusy(false);}
  }
  function deactivatePlan(plan:any){setError("");setPlanDeactivation({plan,reason:""});}
  async function confirmPlanDeactivation(){
    if(!planDeactivation||planDeactivation.reason.trim().length<5){setError("Escribe un motivo de al menos 5 caracteres para desactivar el plan.");return;}
    const {plan,reason}=planDeactivation;setBusy(true);setError("");
    try{await apiFetch(`/v1/admin/membership-plans/${plan.id}/deactivate`,token,{method:"POST",body:JSON.stringify({reason:reason.trim()})});setSuccess(`${plan.name} fue desactivado sin afectar membresías vigentes.`);setPlanDeactivation(null);await load();}catch(cause){setError(cause instanceof Error?cause.message:"No se pudo desactivar el plan.");}finally{setBusy(false);}
  }

  async function createGraceCampaign(){const values=await dialog.open({title:"Nueva campaña de gracia",description:"Se creará inicialmente como borrador y no se aplicará hasta que la actives.",confirmLabel:"Revisar alcance",fields:[{name:"name",label:"Nombre de la campaña",required:true,minLength:3},{name:"days",label:"Días de gracia",type:"number",initialValue:2,required:true,min:0,max:90,step:1},{name:"reason",label:"Motivo y alcance",type:"textarea",required:true,minLength:5}]});if(!values)return;const name=String(values.name).trim();const days=Number(values.days);const reason=String(values.reason).trim();const now=new Date();const end=new Date(now.getTime()+30*24*60*60*1000);setBusy(true);try{const payload={name,reason,scope:"ALL",cooperativeId:null,driverId:null,graceDays:days,allowsTrips:true,campaignKind:"RENEWAL",startsAt:now.toISOString(),endsAt:end.toISOString(),expiryWindowStart:null,expiryWindowEnd:null,priority:0,status:"DRAFT"};const preview=await apiFetch<any>("/v1/admin/membership-grace-policies/preview",token,{method:"POST",body:JSON.stringify(payload)});setBusy(false);const accepted=await dialog.open({eyebrow:"VISTA PREVIA",title:"Confirmar campaña",description:`La campaña alcanzará aproximadamente ${preview.affected??0} membresía(s). Permanecerá en borrador hasta su activación.`,confirmLabel:"Crear borrador"});if(!accepted)return;setBusy(true);await apiFetch("/v1/admin/membership-grace-policies",token,{method:"POST",body:JSON.stringify(payload)});setSuccess("Campaña creada en borrador; no se aplicará hasta activarla de forma controlada.");await load();}catch(reason){setError(reason instanceof Error?reason.message:"No se pudo crear la campaña.");}finally{setBusy(false);}}

  async function saveSettings() {
    setBusy(true);setError("");
    try{await apiFetch("/v1/admin/platform-settings",token,{method:"PATCH",body:JSON.stringify(settings)});setSuccess("Parámetros guardados. Los cambios se aplican desde backend.");await load();}
    catch(reason){setError(reason instanceof Error?reason.message:"No se pudo guardar.");}finally{setBusy(false);}
  }

  async function savePaymentAccount() {
    if(!paymentAccount)return;
    setBusy(true);setError("");
    try{
      await apiFetch("/v1/admin/membership-payment-account",token,{method:"PUT",body:JSON.stringify({bankName:String(paymentAccount.bankName??"").trim(),accountType:String(paymentAccount.accountType??"").trim(),accountIdentifier:String(paymentAccount.accountIdentifier??"").trim(),holderName:String(paymentAccount.holderName??"").trim(),holderIdentification:String(paymentAccount.holderIdentification??"").trim()||null,supportEmail:String(paymentAccount.supportEmail??"").trim()||null,enabled:Boolean(paymentAccount.enabled)})});
      setSuccess("Cuenta de transferencias actualizada y auditada. La aplicación usará estos datos sin requerir una nueva APK.");await load();
    }catch(reason){setError(reason instanceof Error?reason.message:"No se pudo guardar la cuenta de transferencias.");}finally{setBusy(false);}
  }

  async function reviewPayment(proof:any,approve:boolean) {
    setBusy(true);setError("");
    try{
      if(approve)await apiFetch(`/v1/admin/membership-payments/${proof.id}/approve`,token,{method:"POST",body:JSON.stringify({idempotencyKey:`admin-proof-${proof.id}`})});
      else {setBusy(false);const values=await dialog.open({title:"Rechazar comprobante",description:"El conductor podrá revisar la observación y generar o presentar un pago válido.",confirmLabel:"Rechazar comprobante",dangerous:true,fields:[{name:"comment",label:"Motivo obligatorio",type:"textarea",initialValue:"El comprobante no coincide con la transferencia.",required:true,minLength:5}]});if(!values)return;setBusy(true);await apiFetch(`/v1/admin/membership-payments/${proof.id}/reject`,token,{method:"POST",body:JSON.stringify({reason:"INVALID_RECEIPT",comment:String(values.comment).trim()})});}
      setSuccess(approve?"Pago aprobado y membresía activada.":"Comprobante rechazado.");await load();
    }catch(reason){setError(reason instanceof Error?reason.message:"No se pudo revisar el pago.");}finally{setBusy(false);}
  }

  async function openPaymentProof(proofId:string){try{const response=await fetch(apiUrl(`/v1/admin/membership-payments/${proofId}/proof`),{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error("No se pudo abrir el comprobante.");const url=URL.createObjectURL(await response.blob());window.open(url,"_blank","noopener,noreferrer");window.setTimeout(()=>URL.revokeObjectURL(url),60_000);}catch(reason){setError(reason instanceof Error?reason.message:"No se pudo abrir el comprobante.");}}

  async function validateCsv(file:File) {
    setBusy(true);setError("");setImportPreview(undefined);
    try{const contentBase64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(reader.error);reader.onload=()=>resolve(String(reader.result).split(",")[1]??"");reader.readAsDataURL(file);});
      const preview=await apiFetch<any>("/v1/admin/drivers/import/validate",token,{method:"POST",body:JSON.stringify({filename:file.name,contentBase64})});setImportPreview(preview);
    }catch(reason){setError(reason instanceof Error?reason.message:"CSV inválido.");}finally{setBusy(false);}
  }
  async function confirmImport(){if(!importPreview)return;setBusy(true);try{const result=await apiFetch<any>(`/v1/admin/drivers/import/${importPreview.batchId}/confirm`,token,{method:"POST",body:"{}"});setSuccess(`${result.importedRows} conductores creados en pendiente de documentos.`);setImportPreview(undefined);await load();}catch(reason){setError(reason instanceof Error?reason.message:"No se pudo importar.");}finally{setBusy(false);}}
  function downloadTemplate(){const header="nombres,apellidos,identificacion,correo,telefono,cooperativa,placa,marca,modelo,anio,informacion_adicional\n";const anchor=document.createElement("a");anchor.href=URL.createObjectURL(new Blob([header],{type:"text/csv;charset=utf-8"}));anchor.download="plantilla-conductores-costa-go.csv";anchor.click();URL.revokeObjectURL(anchor.href);}

  async function createCollectionPoint(){
    const values=await dialog.open({title:"Crear punto de recaudación",description:"El punto se creará inactivo y sin métodos habilitados para que puedas revisarlo antes de operar.",confirmLabel:"Crear punto",fields:[{name:"name",label:"Nombre del punto",required:true,minLength:3},{name:"code",label:"Código único (opcional)",placeholder:"Se genera a partir del nombre",help:"Usa letras, números y guiones bajos."}]});if(!values)return;
    const name=String(values.name).trim();
    const proposed=name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g,"_").replace(/^_|_$/g,"");
    const code=(String(values.code??"").trim()||proposed).toUpperCase().replace(/[^A-Z0-9_]/g,"");if(!code)return;
    setBusy(true);setError("");try{await apiFetch("/v1/admin/collection-points",token,{method:"POST",body:JSON.stringify({code,name,status:"INACTIVE",cashEnabled:false,deunaEnabled:false,bankTransferEnabled:false,settlementDeadlineHours:48,pendingLimit:null})});setSuccess("Punto creado inactivo. Configura sus métodos antes de activarlo.");await load();}catch(reason){setError(reason instanceof Error?reason.message:"No se pudo crear el punto.");}finally{setBusy(false);}
  }
  async function editCollectionPoint(point:any){
    const currentCollectorIds=(point.collectors??[]).map((collector:any)=>String(collector.id));
    const collectorOptions=(collectionData.collectors as any[])
      .filter(collector=>collector.status==="ACTIVE"||currentCollectorIds.includes(String(collector.id)))
      .map(collector=>({value:String(collector.id),label:`${collector.name} · ${collector.email}${collector.status!=="ACTIVE"?" · Inactivo":""}`}));
    const values=await dialog.open({title:"Configurar punto de recaudación",description:"Busca el establecimiento, pega sus coordenadas o ajusta el pin. Define además qué días abre, el horario y el recaudador responsable.",confirmLabel:"Guardar punto",size:"wide",fields:[{name:"name",label:"Nombre",initialValue:String(point.name??""),required:true,minLength:3},{name:"address",label:"Dirección",initialValue:String(point.address??"")},{name:"reference",label:"Referencia para llegar",initialValue:String(point.reference??"")},{name:"phone",label:"Teléfono",initialValue:String(point.phone??"")},{name:"whatsapp",label:"WhatsApp (opcional)",initialValue:String(point.whatsapp??"")},{name:"email",label:"Correo (opcional)",initialValue:String(point.email??"")},{name:"location",label:"Ubicación exacta",type:"map-point",linkedAddressField:"address",initialValue:{latitude:Number(point.latitude??-0.87),longitude:Number(point.longitude??-79.84)}},{name:"displayOrder",label:"Orden de visualización",type:"number",initialValue:Number(point.displayOrder??0),step:1},...scheduleDays.map(day=>({name:`schedule${day.value}`,label:day.label,type:"schedule-range" as const,initialValue:scheduleValue(point,day.value)})),{name:"status",label:"Estado",type:"select",initialValue:String(point.status??"INACTIVE"),required:true,options:[{value:"ACTIVE",label:"Activo"},{value:"SUSPENDED",label:"Suspendido"},{value:"INACTIVE",label:"Inactivo"}]},{name:"collectorId",label:"Recaudador",type:"select",initialValue:currentCollectorIds[0]??"",options:[{value:"",label:"Sin recaudador"},...collectorOptions],help:"Este usuario podrá confirmar pagos en el punto."},{name:"cashEnabled",label:"Aceptar efectivo",type:"checkbox",initialValue:Boolean(point.cashEnabled)},{name:"deunaEnabled",label:"Aceptar De Una",type:"checkbox",initialValue:Boolean(point.deunaEnabled)},{name:"bankTransferEnabled",label:"Aceptar transferencia verificada",type:"checkbox",initialValue:Boolean(point.bankTransferEnabled)}]});if(!values)return;
    setBusy(true);try{
      const location=values.location as {latitude:number;longitude:number};
      await apiFetch(`/v1/admin/collection-points/${point.id}`,token,{method:"PATCH",body:JSON.stringify({name:String(values.name).trim(),address:String(values.address??"").trim()||null,reference:String(values.reference??"").trim()||null,phone:String(values.phone??"").trim()||null,whatsapp:String(values.whatsapp??"").trim()||null,email:String(values.email??"").trim()||null,latitude:location.latitude,longitude:location.longitude,displayOrder:Number(values.displayOrder??0),timezone:"America/Guayaquil",schedules:schedulesFromValues(values),serviceAreaId:point.serviceAreaId??null,status:String(values.status),cashEnabled:Boolean(values.cashEnabled),deunaEnabled:Boolean(values.deunaEnabled),bankTransferEnabled:Boolean(values.bankTransferEnabled),settlementDeadlineHours:Number(point.settlementDeadlineHours??48),pendingLimit:point.pendingLimit??null})});
      const selectedCollectorId=String(values.collectorId??"");
      for(const collectorId of currentCollectorIds){
        if(collectorId!==selectedCollectorId)await apiFetch(`/v1/admin/collection-points/${point.id}/collectors/${collectorId}`,token,{method:"DELETE"});
      }
      if(selectedCollectorId&&!currentCollectorIds.includes(selectedCollectorId)){
        await apiFetch(`/v1/admin/collection-points/${point.id}/collectors`,token,{method:"POST",body:JSON.stringify({collectorId:selectedCollectorId})});
      }
      setSuccess("Punto y recaudador actualizados correctamente.");await load();
    }catch(reason){setError(reason instanceof Error?reason.message:"No se pudo actualizar.");await load();}finally{setBusy(false);}
  }
  async function settleClosure(closure:any){
    const values=await dialog.open({title:"Conciliar cierre",description:"Registra la referencia bancaria o de liquidación. Esta operación quedará auditada.",confirmLabel:"Confirmar liquidación",fields:[{name:"reference",label:"Referencia",required:true,minLength:3}]});if(!values)return;const reference=String(values.reference).trim();
    setBusy(true);try{await apiFetch(`/v1/admin/collection-closures/${closure.id}/settle`,token,{method:"POST",body:JSON.stringify({method:"BANK_TRANSFER",reference,idempotencyKey:`settlement-${closure.id}`})});setSuccess("Liquidación verificada y cierre conciliado.");await load();}catch(reason){setError(reason instanceof Error?reason.message:"No se pudo conciliar.");}finally{setBusy(false);}
  }
  async function toggleGracePolicy(policy:any){
    const next=policy.status==="ACTIVE"?"PAUSED":"ACTIVE";
    if(next==="ACTIVE"){
      const accepted=await dialog.open({title:"Activar campaña de gracia",description:"La política será considerada inmediatamente por el backend según su alcance y período de vigencia.",confirmLabel:"Activar campaña"});
      if(!accepted)return;
    }
    setBusy(true);try{await apiFetch(`/v1/admin/membership-grace-policies/${policy.id}/status`,token,{method:"PATCH",body:JSON.stringify({status:next})});setSuccess(next==="ACTIVE"?"Campaña activada.":"Campaña pausada.");await load();}catch(reason){setError(reason instanceof Error?reason.message:"No se pudo cambiar el estado.");}finally{setBusy(false);}
  }

  const setting=(key:string,label:string,type:"number"|"text"|"checkbox"="number")=><label>{label}{type==="checkbox"?<input type="checkbox" checked={Boolean(settings?.[key])} onChange={event=>setSettings({...settings,[key]:event.target.checked})}/>:<input type={type} value={settings?.[key]??""} onChange={event=>setSettings({...settings,[key]:type==="number"?Number(event.target.value):event.target.value})}/>}</label>;
  const navigationSetting=(key:"navigationPickupProvider"|"navigationDestinationProvider",label:string)=>{
    const selected=navigationProviderOptions.find(option=>option.value===(settings?.[key]??"MAP_ONLY"))??{value:"MAP_ONLY",label:"Mapa interno de Costa-Go",description:"Muestra la ruta dentro de Costa-Go, sin navegación giro a giro."};
    return <label className="navigation-setting">{label}<select value={selected.value} onChange={event=>setSettings({...settings,[key]:event.target.value})}>{navigationProviderOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select><small>{selected.description}</small></label>;
  };
  const statusOptions=useMemo(()=>Object.entries(membershipLabels),[]);
  return <div className="membership-admin">
    <section className="card membership-hero"><div><span className="eyebrow">GESTIÓN DE CONDUCTORES</span><h2>Membresías y recaudación</h2><p>Vigencia, gracia, cobros confirmados y control de acceso a solicitudes desde una sola fuente.</p></div><button className="secondary" onClick={()=>void load()}>Actualizar</button></section>
    {error&&<div className="alert error">{error}</div>}{success&&<div className="alert success">{success}</div>}
    {dialog.modal}
    {tab==="settings"&&paymentAccount&&<section className="card"><h2>Cuenta para transferencias de membresías</h2><p className="note">Estos datos se muestran al conductor cuando elige transferencia bancaria. Se actualizan desde backend y no quedan incluidos en la APK.</p><div className="settings-grid"><label>Banco<input value={paymentAccount.bankName??""} onChange={event=>setPaymentAccount({...paymentAccount,bankName:event.target.value})}/></label><label>Tipo de cuenta<input value={paymentAccount.accountType??""} onChange={event=>setPaymentAccount({...paymentAccount,accountType:event.target.value})} placeholder="Cuenta corriente"/></label><label>Número de cuenta<input value={paymentAccount.accountIdentifier??""} onChange={event=>setPaymentAccount({...paymentAccount,accountIdentifier:event.target.value})}/></label><label>Titular<input value={paymentAccount.holderName??""} onChange={event=>setPaymentAccount({...paymentAccount,holderName:event.target.value})}/></label><label>RUC / identificación<input value={paymentAccount.holderIdentification??""} onChange={event=>setPaymentAccount({...paymentAccount,holderIdentification:event.target.value})}/></label><label>Correo de pagos<input type="email" value={paymentAccount.supportEmail??""} onChange={event=>setPaymentAccount({...paymentAccount,supportEmail:event.target.value})}/></label><label>Disponible en la aplicación<input type="checkbox" checked={Boolean(paymentAccount.enabled)} onChange={event=>setPaymentAccount({...paymentAccount,enabled:event.target.checked})}/></label></div><button className="primary" disabled={busy||!can("settings:manage")} onClick={()=>void savePaymentAccount()}>Guardar cuenta bancaria</button></section>}
    <div className="membership-stats"><Card label="Activas" value={summary?.active}/><Card label="Vencen en 7 días" value={summary?.expiring7Days} tone="warning"/><Card label="En gracia" value={summary?.grace}/><Card label="Vencidas" value={summary?.expired} tone="danger"/><Card label="Suspendidas" value={summary?.suspended} tone="danger"/><Card label="Cooperativas" value={summary?.cooperatives}/><Card label="Individuales" value={summary?.individual}/><Card label="Ingresos confirmados del mes" value={money(summary?.confirmedIncomeMonth)} tone="positive"/></div>
    <div className="membership-tabs" role="tablist"><button className={tab==="memberships"?"active":""} onClick={()=>setTab("memberships")}>Membresías</button><button className={tab==="plans"?"active":""} onClick={()=>setTab("plans")}>Planes</button>{can("membership_grace:manage")&&<button className={tab==="grace"?"active":""} onClick={()=>setTab("grace")}>Campañas de gracia</button>}{can("payments:transfer_review")&&<button className={tab==="payments"?"active":""} onClick={()=>setTab("payments")}>Pagos pendientes</button>}{can("collection_points:manage")&&<button className={tab==="collection"?"active":""} onClick={()=>setTab("collection")}>Puntos y cierres</button>}{can("settings:view")&&<button className={tab==="settings"?"active":""} onClick={()=>setTab("settings")}>Parámetros</button>}{can("membership_import:manage")&&<button className={tab==="import"?"active":""} onClick={()=>setTab("import")}>Importar CSV</button>}</div>
    {tab==="memberships"&&<section className="card"><div className="membership-toolbar"><label>Estado<select value={filters.status} onChange={event=>setFilters({...filters,status:event.target.value})}><option value="">Todos</option>{statusOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Buscar<input value={filters.search} onChange={event=>setFilters({...filters,search:event.target.value})} placeholder="Nombre, correo o teléfono"/></label><button className="primary" onClick={()=>void load()}>Aplicar</button></div><div className="table-wrap"><table><thead><tr><th>Conductor</th><th>Plan</th><th>Estado</th><th>Vigencia</th><th>Uso</th><th>Próxima renovación</th><th>Cobertura</th><th>Acciones</th></tr></thead><tbody>{memberships.items?.map((item:any)=><tr key={item.id}><td><strong>{item.driver}</strong><small>{item.email}<br/>{item.cooperative??"Individual"}</small></td><td>{labelFor(planLabels,item.plan)}</td><td><span className={`membership-badge ${String(item.status).toLowerCase()}`}>{membershipLabels[item.status]??item.status}</span></td><td>{date(item.expiresAt)}{item.graceEndsAt&&<small>Gracia: {date(item.graceEndsAt)}</small>}</td><td>{item.completedTrips}/{item.includedTrips}<small>{item.extraTrips} adicionales</small></td><td><strong>{money(item.estimatedRenewal,item.currency)}</strong></td><td>{item.payerType==="COOPERATIVE"?"Cooperativa":"Individual"}</td><td>{can("memberships:manage")?<div className="row-actions">{can("payments:courtesy_grant")&&<button className="link" disabled={busy} onClick={()=>void courtesyRenew(item.driverId)}>Activar cortesía</button>}<button className="link" disabled={busy} onClick={()=>void action(item.driverId,"REACTIVATE")}>Reactivar</button><button className="link" disabled={busy} onClick={()=>void grantGrace(item.driverId)}>Dar gracia</button><button className="link" disabled={busy} onClick={()=>void adjustMembership(item.driverId)}>Ajustar</button><button className="link danger" disabled={busy} onClick={()=>void action(item.driverId,"SUSPEND")}>Suspender</button></div>:"Solo lectura"}</td></tr>)}</tbody></table></div>{!memberships.items?.length&&<p className="empty">No hay membresías para este filtro.</p>}</section>}
    {tab==="plans"&&<section className="card"><div className="membership-toolbar"><div><h2>Planes vigentes</h2><p className="note">Cada cambio crea una nueva versión. Los ciclos activos conservan las condiciones con las que fueron adquiridos.</p></div>{can("membership_plans:manage")&&<button className="primary" disabled={busy} onClick={()=>void createPlan()}>+ Nuevo plan</button>}</div><div className="plan-grid">{currentPlans.map(plan=><article key={plan.id}><span>{labelFor(planLabels,plan.code)} · versión {plan.version}</span><h3>{plan.name}</h3><strong>{money(plan.baseAmount,plan.currency)}</strong><p>{plan.durationDays} días · {plan.includedTrips} viajes incluidos</p><small>Tope de renovación: {money(plan.maxRenewalAmount,plan.currency)} · participación adicional {plan.extraTripSharePercent}%</small>{can("membership_plans:manage")&&<div className="row-actions plan-actions"><button className="link" disabled={busy} onClick={()=>void editPlan(plan)}>Editar y publicar versión</button><button className="link danger" disabled={busy} onClick={()=>void deactivatePlan(plan)}>Desactivar</button></div>}</article>)}</div>{!currentPlans.length&&<p className="empty">No existen planes vigentes.</p>}{historicalPlans.length>0&&<details className="plan-history"><summary>Ver historial de versiones ({historicalPlans.length})</summary><div className="table-wrap"><table><thead><tr><th>Plan</th><th>Versión</th><th>Precio</th><th>Duración</th><th>Vigente desde</th><th>Finalizó</th></tr></thead><tbody>{historicalPlans.map(plan=><tr key={plan.id}><td><strong>{plan.name}</strong><small>{plan.code}</small></td><td>{plan.version}</td><td>{money(plan.baseAmount,plan.currency)}</td><td>{plan.durationDays} días</td><td>{date(plan.effectiveFrom)}</td><td>{date(plan.effectiveUntil)}</td></tr>)}</tbody></table></div></details>}</section>}
    {tab==="grace"&&<section className="card"><div className="membership-toolbar"><div><h2>Campañas de gracia</h2><p>Se crean en borrador, muestran el alcance y requieren activación explícita.</p></div><button className="primary" disabled={busy} onClick={()=>void createGraceCampaign()}>+ Nueva campaña</button></div><div className="table-wrap"><table><thead><tr><th>Campaña</th><th>Alcance</th><th>Días</th><th>Vigencia</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{gracePolicies.map(policy=><tr key={policy.id}><td><strong>{policy.name}</strong><small>{policy.reason}</small></td><td>{labelFor(scopeLabels,policy.scope)}</td><td>{policy.graceDays}</td><td>{date(policy.startsAt)}<br/>{date(policy.endsAt)}</td><td><span className={`membership-badge ${String(policy.status).toLowerCase()}`}>{labelFor(operationalStatusLabels,policy.status)}</span></td><td>{policy.status!=="FINISHED"?<button className="link" disabled={busy} onClick={()=>void toggleGracePolicy(policy)}>{policy.status==="ACTIVE"?"Pausar":"Activar"}</button>:"Finalizada"}</td></tr>)}</tbody></table></div>{!gracePolicies.length&&<p className="empty">No existen campañas configuradas.</p>}</section>}
    {tab==="payments"&&<section className="card"><h2>Transferencias por verificar</h2><div className="table-wrap"><table><thead><tr><th>Conductor</th><th>Referencia</th><th>Declarado</th><th>Esperado</th><th>Fecha</th><th>Acción</th></tr></thead><tbody>{pendingPayments.map(item=><tr key={item.id}><td>{item.driver}</td><td>{item.reference}</td><td>{money(item.declaredAmount,item.currency)}</td><td>{money(item.expectedAmount,item.currency)}</td><td>{date(item.createdAt)}</td><td><div className="row-actions"><button className="link" disabled={busy} onClick={()=>void openPaymentProof(item.id)}>Ver comprobante</button><button className="link" disabled={busy} onClick={()=>void reviewPayment(item,true)}>Aprobar</button><button className="link danger" disabled={busy} onClick={()=>void reviewPayment(item,false)}>Rechazar</button></div></td></tr>)}</tbody></table></div>{!pendingPayments.length&&<p className="empty">No existen comprobantes pendientes.</p>}</section>}
    {tab==="collection"&&<><section className="card"><div className="membership-toolbar"><div><h2>Puntos de recaudación</h2><p>Directorio visible para conductores, ubicación, horarios, métodos y personal autorizado.</p></div><button className="primary" disabled={busy} onClick={()=>void createCollectionPoint()}>+ Nuevo punto</button></div><div className="table-wrap"><table><thead><tr><th>Punto</th><th>Ubicación y contacto</th><th>Estado</th><th>Métodos</th><th>Recaudador</th><th>Acciones</th></tr></thead><tbody>{collectionData.points?.map((point:any)=><tr key={point.id}><td><strong>{point.name}</strong><small>{point.code}<br/>{point.serviceArea??"Sin zona"}</small></td><td>{point.address??"Sin dirección"}<small>{point.reference??"Sin referencia"}<br/>{point.phone??"Sin teléfono"}{point.latitude!=null?<><br/>{Number(point.latitude).toFixed(5)}, {Number(point.longitude).toFixed(5)}</>:null}</small></td><td><span className={`membership-badge ${String(point.status).toLowerCase()}`}>{labelFor(operationalStatusLabels,point.status)}</span></td><td>{[point.cashEnabled&&"Efectivo",point.deunaEnabled&&"De Una",point.bankTransferEnabled&&"Transferencia"].filter(Boolean).join(", ")||"Sin métodos"}</td><td>{point.collectors?.length?point.collectors.map((collector:any)=><span key={collector.id}>{collector.name}<br/></span>):"Sin asignar"}</td><td><div className="row-actions"><button className="link" disabled={busy} onClick={()=>void editCollectionPoint(point)}>Configurar</button></div></td></tr>)}</tbody></table></div></section><section className="card"><h2>Cierres pendientes de conciliación</h2><div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Punto</th><th>Recaudador</th><th>Total</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{closures.map(item=><tr key={item.id}><td>{date(item.periodEnd)}</td><td>{item.point}</td><td>{item.collector}</td><td>{money(item.netAmount)}</td><td>{labelFor(operationalStatusLabels,item.status)}</td><td>{item.status==="PENDING_SETTLEMENT"?<button className="link" disabled={busy} onClick={()=>void settleClosure(item)}>Conciliar</button>:"Verificado"}</td></tr>)}</tbody></table></div>{!closures.length&&<p className="empty">No existen cierres registrados.</p>}</section></>}
    {tab==="settings"&&settings&&<section className="card"><h2>Parámetros operativos</h2><p className="note">La aplicación del bloqueo permanece independiente para poder probar cálculos y pagos sin bloquear conductores.</p><div className="settings-grid">{setting("driverMembershipsEnabled","Módulo de membresías","checkbox")}{setting("membershipEnforcementEnabled","Aplicar bloqueo por vigencia","checkbox")}{setting("membershipUsageBillingEnabled","Contabilizar viajes adicionales","checkbox")}{setting("membershipSuspensionSchedulerEnabled","Procesar suspensiones automáticamente","checkbox")}{setting("membershipExpiryNoticeDays","Avisar antes de vencer (días)")}{setting("membershipGraceDays","Gracia general (días)")}{setting("membershipGraceAllowsTrips","Permitir viajes durante gracia","checkbox")}{setting("membershipSuspensionLocalTime","Hora local de suspensión","text")}{setting("membershipTimezone","Zona horaria","text")}{setting("newDriverGraceEnabled","Gracia inicial al aprobar","checkbox")}{setting("newDriverGraceDurationHours","Gracia inicial (horas)")}{setting("newDriverGraceAllowsTrips","Permitir viajes en gracia inicial","checkbox")}{setting("membershipExtraTripSharePercent","Porcentaje sobre adicional del pasajero")}{setting("membershipQrDurationHours","Vigencia QR (horas)")}{navigationSetting("navigationPickupProvider","Navegación hacia el pasajero")}{navigationSetting("navigationDestinationProvider","Navegación hacia el destino")}{setting("textSearchMonthlyBudgetUsd","Presupuesto Text Search USD")}{setting("textSearchHardLimitEnabled","Detener Text Search en el límite","checkbox")}{setting("advertisingRotationSeconds","Rotación de publicidad (segundos)")}{setting("advertisingMaxActivePerZone","Campañas activas máximas por zona")}</div><button className="primary" disabled={busy||!can("settings:manage")} onClick={()=>void saveSettings()}>Guardar parámetros</button>{usage&&<div className="usage-summary"><h3>Consumo del período {usage.period}</h3><p>Text Search Pro: <strong>{usage.textSearch.used}</strong> · costo estimado {money(usage.textSearch.estimatedCost)}</p><p>Navigation SDK: <strong>{usage.navigation.used}</strong> solicitudes registradas</p></div>}</section>}
    {tab==="import"&&<section className="card"><h2>Importar conductores</h2><p>Solo carga información estructurada. Cada conductor debe establecer su contraseña, subir su foto y documentos y pasar por aprobación.</p><div className="import-actions"><button className="secondary" onClick={downloadTemplate}>Descargar plantilla</button><label className="primary file-button">Seleccionar CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={event=>{const file=event.target.files?.[0];if(file)void validateCsv(file);}}/></label></div>{importPreview&&<><div className="membership-stats compact"><Card label="Filas" value={importPreview.totalRows}/><Card label="Válidas" value={importPreview.validRows} tone="positive"/><Card label="Rechazadas" value={importPreview.rejectedRows} tone="danger"/></div><div className="table-wrap"><table><thead><tr><th>Fila</th><th>Conductor</th><th>Correo</th><th>Cooperativa</th><th>Resultado</th></tr></thead><tbody>{importPreview.items.map((item:any)=><tr key={item.rowNumber}><td>{item.rowNumber}</td><td>{item.firstNames} {item.lastNames}</td><td>{item.email}</td><td>{item.cooperativeCode}</td><td>{item.errors.length?item.errors.join(", "):"Válida"}</td></tr>)}</tbody></table></div><button className="primary" disabled={busy||importPreview.validRows===0} onClick={()=>void confirmImport()}>Confirmar {importPreview.validRows} cuentas</button></>}</section>}
    {planEditor&&<div className="membership-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)setPlanEditor(null);}}><form className="membership-modal-card plan-editor-modal" role="dialog" aria-modal="true" aria-labelledby="plan-editor-title" onSubmit={event=>{event.preventDefault();void submitPlan();}}><div className="membership-modal-heading"><div><span className="eyebrow">{planEditor.mode==="create"?"NUEVO PLAN":"NUEVA VERSIÓN"}</span><h2 id="plan-editor-title">{planEditor.mode==="create"?"Crear plan de membresía":`Actualizar ${planEditor.source.name}`}</h2></div><button type="button" className="modal-close-button" aria-label="Cerrar" disabled={busy} onClick={()=>setPlanEditor(null)}>×</button></div>{planEditor.mode==="edit"&&<p className="plan-version-note">Las membresías activas conservarán la versión {planEditor.source.version} hasta finalizar su ciclo. Solo las nuevas activaciones usarán estos valores.</p>}<div className="plan-form-grid"><label className="wide">Nombre visible<input autoFocus required minLength={2} value={planEditor.draft.name} onChange={event=>setPlanEditor({...planEditor,draft:{...planEditor.draft,name:event.target.value}})} placeholder="Ej. Plan de 5 meses"/></label>{planEditor.mode==="create"&&<label className="wide">Código interno (opcional)<input value={planEditor.draft.code} onChange={event=>setPlanEditor({...planEditor,draft:{...planEditor.draft,code:event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,"")}})} placeholder="Se genera automáticamente"/><small>Solo se usa internamente; no lo verá el conductor.</small></label>}<label>Unidad de duración<select value={planEditor.draft.periodUnit} onChange={event=>setPlanEditor({...planEditor,draft:{...planEditor.draft,periodUnit:event.target.value as PlanEditorState["draft"]["periodUnit"]}})}><option value="DAY">Días</option><option value="MONTH">Meses</option><option value="QUARTER">Trimestres</option><option value="YEAR">Años</option></select></label><label>Cantidad<input type="number" required min="1" max="24" step="1" value={planEditor.draft.periodCount} onChange={event=>setPlanEditor({...planEditor,draft:{...planEditor.draft,periodCount:Number(event.target.value)}})}/></label><div className="plan-duration-preview wide"><strong>{planDurationDays(planEditor.draft.periodUnit,planEditor.draft.periodCount)||0} días de vigencia</strong><span>Puede crear planes de 4, 5, 6 meses o cualquier período permitido.</span></div><label>Precio base (USD)<input type="number" required min="0" step="0.01" value={planEditor.draft.baseAmount} onChange={event=>setPlanEditor({...planEditor,draft:{...planEditor.draft,baseAmount:Number(event.target.value)}})}/></label><label>Viajes incluidos<input type="number" required min="0" step="1" value={planEditor.draft.includedTrips} onChange={event=>setPlanEditor({...planEditor,draft:{...planEditor.draft,includedTrips:Number(event.target.value)}})}/></label><label>Tope de renovación (USD)<input type="number" required min={planEditor.draft.baseAmount} step="0.01" value={planEditor.draft.maxRenewalAmount} onChange={event=>setPlanEditor({...planEditor,draft:{...planEditor.draft,maxRenewalAmount:Number(event.target.value)}})}/></label><label>Participación adicional (%)<input type="number" required min="0" max="100" step="0.01" value={planEditor.draft.extraTripSharePercent} onChange={event=>setPlanEditor({...planEditor,draft:{...planEditor.draft,extraTripSharePercent:Number(event.target.value)}})}/></label></div><div className="membership-modal-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setPlanEditor(null)}>Cancelar</button><button type="submit" className="primary" disabled={busy}>{busy?"Guardando…":planEditor.mode==="create"?"Crear plan":"Publicar nueva versión"}</button></div></form></div>}
    {planDeactivation&&<div className="membership-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)setPlanDeactivation(null);}}><form className="membership-modal-card confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="deactivate-plan-title" onSubmit={event=>{event.preventDefault();void confirmPlanDeactivation();}}><div className="membership-modal-heading"><div><span className="eyebrow danger-text">DESACTIVAR PLAN</span><h2 id="deactivate-plan-title">{planDeactivation.plan.name}</h2></div><button type="button" className="modal-close-button" aria-label="Cerrar" disabled={busy} onClick={()=>setPlanDeactivation(null)}>×</button></div><p>Ya no estará disponible para nuevas activaciones. Las membresías que ya lo usan continuarán normalmente hasta finalizar.</p><label>Motivo de la desactivación<textarea autoFocus required minLength={5} rows={4} value={planDeactivation.reason} onChange={event=>setPlanDeactivation({...planDeactivation,reason:event.target.value})} placeholder="Describe brevemente el motivo"/></label><div className="membership-modal-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setPlanDeactivation(null)}>Conservar plan</button><button type="submit" className="danger-button" disabled={busy}>{busy?"Procesando…":"Desactivar plan"}</button></div></form></div>}
  </div>;
}
