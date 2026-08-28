// Isolated visual QA ONLY. Never imported by production or deployed. No DB, email, push or payments.
// node scripts/admin-console-preview.mjs → http://localhost:3300
// Local fixture login: qa@example.test / visual-test (not a real account).
import {createServer} from '../apps/admin/node_modules/vite/dist/node/index.js';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const permissionsText=await readFile(resolve(repo,'apps/api/src/permissions.ts'),'utf8');
const permissions=[...permissionsText.split('export const allPermissions = [')[1].split('] as const')[0].matchAll(/"([^"]+)"/g)].map(m=>m[1]);
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),now=new Date().toISOString();
const passengers=Array.from({length:22},(_,i)=>({id:id(i+1),name:'Pasajero de prueba '+(i+1),email:`pasajero${i+1}@example.test`,phone:'0990000000',status:i%7===0?'SUSPENDED':'ACTIVE',trips:i,lastTrip:i?now:null,cancellationCount:i%3,cancellationTotal:i%3}));
const drivers=Array.from({length:18},(_,i)=>({id:id(i+101),name:'Conductor de prueba '+(i+1),email:`conductor${i+1}@example.test`,phone:'0990000000',status:'ACTIVE',approvalStatus:i%4?'APROBADO':'PENDIENTE_DOCUMENTOS',vehicle:'MT-'+(i+1),rating:4.8,requiredDocumentCount:4,approvedRequiredDocuments:i%4?4:2,approvedDocuments:i%4?4:2,cooperativeName:'Cooperativa de prueba',cooperativeId:id(500),deunaEnabled:i%2===0,createdAt:now}));
const trips=Array.from({length:24},(_,i)=>({id:id(i+201),passenger:passengers[i%22].name,driver:i%3?drivers[i%18].name:null,origin:'Atacames · Origen de prueba',destination:'Tonsupa · Destino de prueba',destinations:[{reference:'Destino de prueba'}],status:i%3?'COMPLETED':'NO_DRIVER',totalCents:110,requestedAt:now,paymentMethod:'CASH',createdAt:now}));
const summary={metrics:{requestedTrips:24,completedTrips:16,withoutDriver:8,connectedDrivers:5,openIncidents:0,acceptanceRate:66.67},tripsByDay:[{day:new Date().toISOString().slice(0,10),requested:24}],origins:[{label:'Atacames · Datos de prueba',value:24}],destinations:[],byHour:[],driverRanking:[],passengerRanking:[],cooperatives:[]};
const fiscal={collected:24,invoiced:0,pendingAmount:24,subtotal:0,tax:0,invoiceCount:2,authorizedCount:0,pendingCount:2,rejectedCount:0,errorCount:0,clients:{active:0,new:0},averageTicket:0,averagePerClient:0,averageInvoicesPerClient:0,averagePerDriver:0,averagePerBusiness:0,recurringClients:0,collectedByDay:[{label:new Date().toISOString().slice(0,10),value:24}],byDay:[],byMonth:[],bySource:[],byService:[],byStatus:[],newClients:[],topClients:[],clientMetricsScope:'Fixture local, no es información real.'};
const emptyMember={active:0,expiring7Days:0,grace:0,expired:0,suspended:0,confirmedIncomeMonth:0};
const routes={
 '/health':{status:'ok'},'/v1/admin/dashboard':summary,
 '/v1/admin/dashboard/details':{columns:[{key:'name',label:'Pasajero'}],rows:passengers,total:22},
 '/v1/admin/operations':{metrics:{activeTrips:0,searchingTrips:0,connectedDrivers:0,availableDrivers:0},activeTrips:[],driverLocations:[],upcomingTrips:[],criticalIncidents:[],updatedAt:now},
 '/v1/admin/alerts':{alerts:[],updatedAt:now},'/v1/admin/push-deliveries':{summary:{},deliveries:[]},
 '/v1/admin/passengers':passengers,'/v1/admin/drivers':drivers,'/v1/admin/trips':trips,
 '/v1/admin/cooperatives':[{id:id(500),name:'Cooperativa de prueba',status:'ACTIVE',drivers:18,activeDrivers:18,connectedDrivers:0,tripsThisMonth:24}],
 '/v1/admin/driver-approvals':[], '/v1/admin/driver-approval-settings':{adminEmails:[],emailEnabled:false,internalEnabled:true,pushEnabled:true},
 '/v1/admin/permissions':permissions,'/v1/admin/roles':['ADMIN','SUPPORT','COLLECTOR','FINANCE','COMMERCIAL'].map(role=>({role,name:role,permissions})),
 '/v1/admin/users':[{id:id(999),name:'Administrador QA',email:'qa@example.test',role:'ADMIN',status:'ACTIVE',permissions}],
 '/v1/admin/access/users':[{id:id(999),name:'Administrador QA',email:'qa@example.test',role:'SUPER_ADMIN',status:'ACTIVE',permissions,overrides:[]},{id:id(998),name:'Comercial QA',email:'comercial@example.test',role:'COMMERCIAL',status:'ACTIVE',permissions:[],overrides:[]}],
 '/v1/admin/access/roles':[{role:'SUPER_ADMIN',permissions},{role:'COMMERCIAL',permissions:[]},{role:'SOPORTE',permissions:[]}],
 '/v1/admin/fleet/report':{summary:{totalUnits:0,activeUnits:0,activeDrivers:0,completed:0,cancelled:0,inactiveUnits:0,incidents:0,operationSeconds:0},items:[]},
 '/v1/admin/notifications':[], '/v1/admin/database':{connected:true,database:'fixture_visual_no_database',postgres_version:'Solo fixture visual',postgis_version:'Solo fixture visual'},
 '/v1/admin/memberships/dashboard':emptyMember,'/v1/admin/memberships':{items:[],page:1,limit:25,total:0},
 '/v1/admin/collection-points':{points:[],collectors:[]},'/v1/admin/membership-payment-account':{account:null},
 '/v1/admin/api-usage':{period:'QA',textSearch:{used:0,estimatedCost:0},navigation:{used:0}},
 '/v1/admin/fiscal/dashboard':fiscal,'/v1/admin/fiscal/options':{zones:[]},
 '/v1/admin/fiscal/config':{emissionAvailable:false,provider:'NONE',environment:'TEST',emailMode:'CORPORATE'},
 '/v1/admin/commercial/dashboard':{newLeads:0,requiresContact:0,openOrders:0,pendingCampaigns:0,activeCampaigns:0,monthlySales:0,activeAdvertisers:0},
 '/v1/admin/commercial/settings':{paymentMethods:[],bankAccounts:[]},'/v1/admin/commercial/cash-closures':{pending:[],closures:[]},
 '/v1/admin/fleet/vehicles':{items:[]},'/v1/admin/fleet/options':{users:[],cooperatives:[]},
 '/v1/admin/settings':{searchRadiusMeters:4000,driverSearchInitialRadiusMeters:1000,driverSearchRadiusIncrementMeters:1000,driverSearchRoundWaitSeconds:15,scheduledTripLeadMinutes:10,documentExpiryAlertDays:30},
 '/v1/admin/platform-settings':{},'/v1/collector/me':{user:{name:'Recaudador QA'},points:[]},'/v1/admin/commercial/plans':[],
};
const server=await createServer({configFile:false,envDir:false,root:resolve(repo,'apps/admin'),esbuild:{jsx:'automatic'},define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api'),'import.meta.env.VITE_SENTRY_DSN':JSON.stringify(''),'import.meta.env.VITE_GOOGLE_MAPS_WEB_API_KEY':JSON.stringify('')},plugins:[{name:'isolated-console-fixtures',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
 const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/'))return next();res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');const path=url.pathname.slice(4);console.log('QA',req.method,path);
 if(path==='/v1/admin/session'&&req.method==='POST'){let raw='';for await(const part of req)raw+=part;let body={};try{body=JSON.parse(raw);}catch{}const scoped=String(body.email??'').startsWith('support');res.end(JSON.stringify({token:'local-visual-fixture-only',user:{id:id(999),name:scoped?'Soporte QA':'Administrador QA',email:'qa@example.test',role:scoped?'SUPPORT':'ADMIN',permissions:scoped?['support:view','incidents:view','faq:view']:permissions}}));return;}
 if(req.method!=='GET'){res.statusCode=409;res.end(JSON.stringify({error:'QA_READ_ONLY',message:'Vista local de pruebas: no realiza cambios reales.'}));return;}
 let data=routes[path];if(path.includes('/fiscal/')&&data===undefined)data={items:[],total:0};
 if(path==='/v1/admin/console/search')data={results:[{id:drivers[0].id,title:drivers[0].name,subtitle:drivers[0].email,module:'drivers',query:drivers[0].email}]};
 if(path==='/v1/admin/trips'&&url.searchParams.has('record'))data=trips.filter(t=>t.id===url.searchParams.get('record'));
 if(path.startsWith('/v1/admin/dashboard/details/')||path.startsWith('/v1/admin/operations/details/'))data={columns:[{key:'name',label:'Pasajero'}],rows:passengers.slice(0,15),total:22,pageSize:15,page:1};
 if(path.includes('cancellations'))data={count:0,total:0,items:[],history:[],policy:{tiers:[],cycleDays:30}};
 if(path==='/v1/admin/settings/passenger-cancellations')data={enabled:true,cycleDurationDays:30,steps:[{fromCount:1,suspensionDays:0},{fromCount:3,suspensionDays:2},{fromCount:4,suspensionDays:5},{fromCount:6,suspensionDays:null}]};
 if(data===undefined)data=[];res.end(JSON.stringify(data));
 });}}],server:{host:'127.0.0.1',port:3300,strictPort:true}});
await server.listen();server.printUrls();console.log('QA aislada: datos sintéticos locales; sin conexión a producción.');
