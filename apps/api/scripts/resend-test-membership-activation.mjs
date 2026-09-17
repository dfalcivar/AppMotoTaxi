import {createHash} from "node:crypto";
import {closeDatabase,database} from "../dist/database.js";
import {sendMembershipActivationConfirmation} from "../dist/membership-activation.js";

const target=process.env.TEST_MEMBERSHIP_USER?.trim();
if(!target)throw new Error("Falta TEST_MEMBERSHIP_USER con el correo, UUID o nombre exacto del conductor");
const execute=process.argv.includes("--execute");
const suppliedToken=process.argv.find(value=>value.startsWith("--token="))?.slice("--token=".length);
if(execute&&process.env.TEST_MEMBERSHIP_EMAIL_RESEND!=="YES_RESEND_COURTESY_EMAIL"){
  throw new Error("Falta TEST_MEMBERSHIP_EMAIL_RESEND=YES_RESEND_COURTESY_EMAIL");
}

const sql=database();
try{
  const rows=await sql`
    select u.id::text as "userId",u.full_name as name,lower(u.email) as email,
      dm.id::text as "membershipId",coalesce(mp.name,dm.plan_snapshot->>'name',dm.plan_code) as "planName",
      dm.included_trips_snapshot::int as "includedTrips",dm.completed_trips::int as "completedTrips",
      mp.pack_validity_days::int as "packValidityDays",dm.expires_at as "expiresAt",
      p.id::text as "paymentId",p.method,p.status as "paymentStatus"
    from users u join drivers d on d.user_id=u.id
    join driver_memberships dm on dm.driver_id=u.id and dm.cycle_closed_at is null
    left join membership_plans mp on mp.id=dm.plan_id
    join lateral(
      select p.* from membership_payments p
      where p.membership_cycle_id=dm.id order by p.confirmed_at desc limit 1
    )p on true
    where u.deleted_at is null and (
      u.id::text=${target} or lower(u.email)=lower(${target}) or lower(u.full_name)=lower(${target})
    )
  `;
  if(rows.length!==1)throw new Error(`TARGET_ACTIVE_MEMBERSHIP_COUNT_${rows.length}`);
  const record=rows[0];
  const blockers=[];
  if(record.method!=="COURTESY"||record.paymentStatus!=="CONFIRMED")blockers.push("LATEST_PAYMENT_IS_NOT_CONFIRMED_COURTESY");
  if(Number(record.completedTrips)!==0)blockers.push("MEMBERSHIP_ALREADY_USED");
  const fingerprint={userId:record.userId,membershipId:record.membershipId,paymentId:record.paymentId,planName:record.planName,includedTrips:Number(record.includedTrips),packValidityDays:Number(record.packValidityDays)};
  const planToken=createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex").toUpperCase();
  const report={mode:execute?"EXECUTE_REQUESTED":"DRY_RUN",record,blockers,planToken};
  if(!execute){
    console.log(JSON.stringify(report));
  }else{
    if(blockers.length)throw new Error(`RESEND_BLOCKED:${blockers.join(",")}`);
    if(!suppliedToken||suppliedToken!==planToken)throw new Error("STALE_OR_INVALID_PLAN_TOKEN");
    await sendMembershipActivationConfirmation(String(record.paymentId),String(record.membershipId));
    console.log(JSON.stringify({...report,mode:"EXECUTED",emailResent:true,membershipChanged:false}));
  }
}finally{
  await closeDatabase();
}
