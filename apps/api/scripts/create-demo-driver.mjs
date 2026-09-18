import postgres from "postgres";
import {createHash} from "node:crypto";

const email=(process.env.DEMO_ACCOUNT_EMAIL??"demo@costa-go.com").trim().toLowerCase();
const fullName=(process.env.DEMO_ACCOUNT_NAME??"Conductor Demo Costa-Go").trim();
const phone=(process.env.DEMO_ACCOUNT_PHONE??"+593990000026").trim();
const vehicleIdentifier=(process.env.DEMO_VEHICLE_IDENTIFIER??"COSTAGO-DEMO-01").trim().toUpperCase();
const execute=process.argv.includes("--execute");
const suppliedToken=process.argv.find(value=>value.startsWith("--token="))?.slice("--token=".length);
const password=process.env.DEMO_ACCOUNT_PASSWORD;
if(!process.env.DATABASE_URL)throw new Error("Falta DATABASE_URL");
if(execute&&process.env.DEMO_ACCOUNT_CREATE!=="YES_CREATE_DEMO_DRIVER")throw new Error("Falta DEMO_ACCOUNT_CREATE=YES_CREATE_DEMO_DRIVER");
if(execute&&(!password||password.length<8))throw new Error("Falta DEMO_ACCOUNT_PASSWORD válida");

const db=postgres(process.env.DATABASE_URL,{max:1});
const plan={email,fullName,phone,vehicleIdentifier};
const planToken=createHash("sha256").update(JSON.stringify(plan)).digest("hex").toUpperCase();

async function inspect(sql,{lock=false}={}){
  if(lock)await sql`select pg_advisory_xact_lock(20260917)`;
  const [state]=await sql`
    select
      exists(select 1 from users where lower(email)=lower(${email}) and deleted_at is null) as "emailExists",
      exists(select 1 from users where phone_e164=${phone} and deleted_at is null) as "phoneExists",
      exists(select 1 from vehicles where merged_into is null and fleet_normalize_identifier(identifier)=fleet_normalize_identifier(${vehicleIdentifier})) as "vehicleExists",
      (select id::text from users where deleted_at is null and status='ACTIVE' and role::text in ('SUPER_ADMIN','ADMIN') order by created_at limit 1) as "actorId"
  `;
  const blockers=[];
  if(state?.emailExists)blockers.push("EMAIL_ALREADY_EXISTS");
  if(state?.phoneExists)blockers.push("PHONE_ALREADY_EXISTS");
  if(state?.vehicleExists)blockers.push("VEHICLE_ALREADY_EXISTS");
  if(!state?.actorId)blockers.push("ACTIVE_ADMIN_REQUIRED");
  return {mode:execute?"EXECUTE_REQUESTED":"DRY_RUN",plan,actorId:state?.actorId??null,blockers,planToken};
}

try{
  if(!execute){
    const report=await db.begin("isolation level repeatable read read only",sql=>inspect(sql));
    console.log(JSON.stringify(report));
  }else{
    const result=await db.begin("isolation level serializable",async sql=>{
      const report=await inspect(sql,{lock:true});
      if(report.blockers.length)throw new Error(`CREATE_BLOCKED:${report.blockers.join(",")}`);
      if(!suppliedToken||suppliedToken!==planToken)throw new Error("STALE_OR_INVALID_PLAN_TOKEN");
      const [user]=await sql`
        insert into users(phone_e164,full_name,email,password_hash,role,status,phone_verified_at,email_verified_at,
          terms_accepted_at,must_change_password,last_mobile_role)
        values(${phone},${fullName},${email},crypt(${password},gen_salt('bf')),'DRIVER','ACTIVE',now(),now(),now(),false,'DRIVER')
        returning id::text,full_name as name,email,phone_e164 as phone,status
      `;
      await sql`insert into mobile_account_roles(user_id,role) values(${user.id},'PASSENGER'),(${user.id},'DRIVER') on conflict do nothing`;
      await sql`
        insert into drivers(user_id,approval_note,approved_at,approved_by,is_available,approval_status,approval_observation,approval_updated_at)
        values(${user.id},'Cuenta demo autorizada para presentaciones Costa-Go',now(),${report.actorId},false,'APROBADO',null,now())
      `;
      const [vehicle]=await sql`
        insert into vehicles(driver_id,identifier,maximum_passengers,status,brand,model,color,unit_number,
          declared_owner_name,created_by,fleet_status)
        values(${user.id},${vehicleIdentifier},3,'ACTIVE','Costa-Go','Demo','Azul','DEMO-01','Costa-Go',${report.actorId},'VERIFIED')
        returning id::text,identifier,fleet_status as "fleetStatus"
      `;
      await sql`
        insert into user_vehicle_relations(user_id,vehicle_id,relation_type,status,source,reviewed_at,reviewed_by,reason)
        values(${user.id},${vehicle.id},'AUTHORIZED_DRIVER','APPROVED','ADMIN',now(),${report.actorId},'Unidad exclusiva para demostraciones Costa-Go')
      `;
      await sql`
        insert into audit_log(actor_id,action,entity_type,entity_id,next_value,reason)
        values(${report.actorId},'DEMO_DRIVER_CREATED','USER',${user.id},
          ${JSON.stringify({email,role:"DRIVER",approvalStatus:"APROBADO",vehicleIdentifier})}::jsonb,
          'Cuenta demo solicitada para pruebas y presentaciones')
      `;
      return {...report,mode:"EXECUTED",user,vehicle};
    });
    const [check]=await db`
      select u.id::text,u.email,u.status,d.approval_status as "approvalStatus",d.is_available as "isAvailable",
        u.password_hash=crypt(${password},u.password_hash) as "passwordVerified",
        array(select role::text from mobile_account_roles where user_id=u.id order by role::text) as roles,
        (select count(*)::int from driver_memberships where driver_id=u.id and cycle_closed_at is null) as "activeMemberships",
        v.identifier,v.fleet_status as "fleetStatus",r.status as "vehicleRelationStatus"
      from users u join drivers d on d.user_id=u.id
      join user_vehicle_relations r on r.user_id=u.id and r.relation_type='AUTHORIZED_DRIVER'
      join vehicles v on v.id=r.vehicle_id where u.id=${result.user.id}
    `;
    console.log(JSON.stringify({...result,verification:check}));
  }
}finally{
  await db.end({timeout:5});
}
