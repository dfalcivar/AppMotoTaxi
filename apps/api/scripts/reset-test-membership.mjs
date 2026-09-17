import postgres from "postgres";
import {createHash} from "node:crypto";

const target=process.env.TEST_MEMBERSHIP_USER?.trim();
if(!target)throw new Error("Falta TEST_MEMBERSHIP_USER con el correo, UUID o nombre exacto del conductor");
if(!process.env.DATABASE_URL)throw new Error("Falta DATABASE_URL");

const execute=process.argv.includes("--execute");
const tokenArgument=process.argv.find(value=>value.startsWith("--token="));
const suppliedToken=tokenArgument?.slice("--token=".length);
if(execute&&process.env.TEST_MEMBERSHIP_RESET!=="YES_CLOSE_TEST_MEMBERSHIP"){
  throw new Error("Falta TEST_MEMBERSHIP_RESET=YES_CLOSE_TEST_MEMBERSHIP");
}

const db=postgres(process.env.DATABASE_URL,{max:1});
const stableToken=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex").toUpperCase();

async function inspect(sql,{lock=false}={}){
  const users=await sql`
    select u.id::text,u.full_name as name,lower(u.email) as email
    from users u join drivers d on d.user_id=u.id
    where u.deleted_at is null and (
      u.id::text=${target} or lower(u.email)=lower(${target}) or lower(u.full_name)=lower(${target})
    )
    order by u.id
  `;
  if(users.length!==1)throw new Error(`TARGET_USER_COUNT_${users.length}`);
  const user=users[0];
  const memberships=await sql.unsafe(`
    select dm.id::text,dm.plan_code as "planCode",coalesce(dm.plan_snapshot->>'name',mp.name,dm.plan_code) as "planName",
      dm.plan_type_snapshot as "planType",dm.status,dm.source,dm.included_trips_snapshot::int as "includedTrips",
      dm.completed_trips::int as "completedTrips",greatest(0,dm.included_trips_snapshot-dm.completed_trips)::int as "remainingTrips",
      dm.starts_at as "startsAt",dm.expires_at as "expiresAt"
    from driver_memberships dm left join membership_plans mp on mp.id=dm.plan_id
    where dm.driver_id=$1 and dm.cycle_closed_at is null
    order by dm.created_at desc${lock?" for update of dm":""}
  `,[user.id]);
  if(memberships.length!==1)throw new Error(`OPEN_MEMBERSHIP_COUNT_${memberships.length}`);
  const membership=memberships[0];
  const payments=await sql`
    select p.id::text,p.method,p.status,p.amount::text,o.id::text as "orderId",o.status as "orderStatus"
    from membership_payments p join membership_payment_orders o on o.id=p.order_id
    where p.membership_cycle_id=${membership.id} order by p.confirmed_at
  `;
  const [usage]=await sql`
    select count(*) filter(where reversed_at is null)::int as active
    from membership_cycle_trip_usages where membership_cycle_id=${membership.id}
  `;
  const blockers=[];
  if(membership.planType!=="TRIP_PACK")blockers.push("NOT_A_TRIP_PACK");
  if(Number(membership.completedTrips)!==0||Number(usage?.active??0)!==0)blockers.push("MEMBERSHIP_HAS_TRIP_USAGE");
  if(payments.length===0||payments.some(payment=>payment.method!=="COURTESY"))blockers.push("NOT_EXCLUSIVELY_COURTESY");
  const fingerprint={
    userId:user.id,membershipId:membership.id,planCode:membership.planCode,
    includedTrips:Number(membership.includedTrips),completedTrips:Number(membership.completedTrips),
    paymentIds:payments.map(payment=>payment.id)
  };
  return {mode:execute?"EXECUTE_REQUESTED":"DRY_RUN",user,membership,payments,activeTripUsages:Number(usage?.active??0),blockers,planToken:stableToken(fingerprint)};
}

try{
  if(!execute){
    const report=await db.begin("isolation level repeatable read read only",sql=>inspect(sql));
    console.log(JSON.stringify(report));
  }else{
    const result=await db.begin("isolation level serializable",async sql=>{
      const report=await inspect(sql,{lock:true});
      if(report.blockers.length)throw new Error(`RESET_BLOCKED:${report.blockers.join(",")}`);
      if(!suppliedToken||suppliedToken!==report.planToken)throw new Error("STALE_OR_INVALID_PLAN_TOKEN");
      await sql`
        update driver_memberships set status='CLOSED',cycle_closed_at=now(),
          cycle_close_reason='TEST_RESET_EMAIL_VALIDATION',updated_at=now()
        where id=${report.membership.id} and cycle_closed_at is null
      `;
      const cancelled=await sql`
        update membership_payment_orders set status='CANCELLED',cancelled_at=now(),
          cancellation_reason_code='OTHER',cancellation_observation='Restablecimiento aislado de membresía de prueba',
          cancellation_channel='ADMIN',updated_at=now()
        where driver_id=${report.user.id} and status in ('PENDING','PENDING_VERIFICATION')
        returning id::text
      `;
      await sql`
        insert into audit_log(actor_id,action,entity_type,entity_id,previous_value,next_value,reason)
        values(null,'TEST_MEMBERSHIP_RESET','DRIVER_MEMBERSHIP',${report.membership.id},
          ${JSON.stringify(report.membership)}::jsonb,
          ${JSON.stringify({status:"CLOSED",remainingTrips:0,cancelledPendingOrders:cancelled.map(row=>row.id)})}::jsonb,
          'Restablecimiento solicitado para validar una nueva cortesía y su correo')
      `;
      return {...report,mode:"EXECUTED",cancelledPendingOrders:cancelled.map(row=>row.id)};
    });
    const [check]=await db`select count(*)::int as total from driver_memberships where driver_id=${result.user.id} and cycle_closed_at is null`;
    console.log(JSON.stringify({...result,openMembershipsAfter:Number(check?.total??-1)}));
  }
}finally{
  await db.end({timeout:5});
}
