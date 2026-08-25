-- Las transferencias elegidas directamente por el comercio pertenecen a
-- Finanzas. Corrige asignaciones históricas creadas antes de separar los flujos.
with automatic_orders as (
  select distinct orders.id
  from advertising_orders orders
  join advertising_payments payments on payments.order_id = orders.id
  join advertising_payment_methods methods on methods.id = payments.payment_method_id
  where methods.code = 'BANK_TRANSFER'
)
update advertising_orders orders
set assigned_commercial_id = null,
    updated_at = now()
from automatic_orders automatic
where orders.id = automatic.id
  and orders.assigned_commercial_id is not null;

update advertising_leads leads
set assigned_commercial_id = null,
    updated_at = now()
where leads.assigned_commercial_id is not null
  and exists (
    select 1
    from advertising_orders orders
    join advertising_payments payments on payments.order_id = orders.id
    join advertising_payment_methods methods on methods.id = payments.payment_method_id
    where orders.lead_id = leads.id and methods.code = 'BANK_TRANSFER'
  )
  and not exists (
    select 1
    from advertising_orders orders
    join advertising_payments payments on payments.order_id = orders.id
    join advertising_payment_methods methods on methods.id = payments.payment_method_id
    where orders.lead_id = leads.id
      and methods.code <> 'BANK_TRANSFER'
      and orders.assigned_commercial_id is not null
  );

update advertisers advertiser
set assigned_commercial_id = null,
    updated_at = now()
where advertiser.assigned_commercial_id is not null
  and exists (
    select 1
    from advertising_orders orders
    join advertising_payments payments on payments.order_id = orders.id
    join advertising_payment_methods methods on methods.id = payments.payment_method_id
    where orders.advertiser_id = advertiser.id and methods.code = 'BANK_TRANSFER'
  )
  and not exists (
    select 1
    from advertising_orders orders
    join advertising_payments payments on payments.order_id = orders.id
    join advertising_payment_methods methods on methods.id = payments.payment_method_id
    where orders.advertiser_id = advertiser.id
      and methods.code <> 'BANK_TRANSFER'
      and orders.assigned_commercial_id is not null
  );
