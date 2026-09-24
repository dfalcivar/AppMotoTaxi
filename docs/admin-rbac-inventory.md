# Inventario RBAC del panel administrativo

Generado desde las rutas reales con `node scripts/admin-permission-inventory.mjs`. El menú se define en `apps/admin/src/main.tsx` y `apps/admin/src/console-model.ts`; las acciones internas están en los componentes de cada módulo. Una guardia indirecta requiere inspección manual del controlador.

Rutas administrativas detectadas: **236**. Permisos del catálogo existente y ampliado: **104**.

## Módulos visibles y acciones

| Módulo | Submódulos y acciones visibles |
| --- | --- |
| Inicio y análisis | Métricas, detalles, filtros, mapas y exportaciones |
| Operación y alertas | Buscar, consultar detalles de viajes, disponibilidad y alertas |
| Viajes | Consultar, filtrar, ver detalle y cancelar |
| Conductores | Consultar, aprobar, rechazar, observar, suspender, revisar y subir documentos, editar cuenta |
| Mototaxis y flota | Ver unidades, responsables, relaciones, auditoría y jornadas; gestionar según permiso |
| Pasajeros | Consultar, editar estado, historial y reglas de cancelación |
| Cooperativas | Consultar, crear, editar y ver analítica |
| Membresías y cobranzas | Vigencia, planes, cortesías, órdenes, recargas, transferencias, caja, conciliaciones y puntos de cobro |
| Finanzas y facturación | Clientes fiscales, pagos, facturas, XML/RIDE, reenvío, consulta, reintento y notas de crédito |
| Comercial y publicidad | Prospectos, comercios, órdenes, pagos, conciliación, campañas, banners y planes comerciales |
| Notificaciones | Salud, diagnósticos, campañas, pruebas, recordatorios, configuración y versiones de app |
| Tarifas y cobertura | Versiones, sectores, reglas por trayecto, zonas y áreas de servicio |
| Configuración | Parámetros operativos, comerciales, fiscales, búsqueda y seguridad |
| Soporte | Incidentes, mensajes, respuestas, cierre y preguntas frecuentes |
| Usuarios y roles | Usuarios web, acceso móvil, restablecimiento y roles configurables |
| Auditoría y sistema | Historial de acciones, salud y uso de API |

## Mapa ruta → acción → permiso

| Módulo UI | Submódulo | Acción | Ruta | Permiso / guardia | Código |
| --- | --- | --- | --- | --- | --- |
| Usuarios y roles | custom-roles | GET | `/v1/admin/access/custom-roles` | roles:manage (Super Administrador) | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L527) |
| Usuarios y roles | custom-roles | POST | `/v1/admin/access/custom-roles` | roles:manage (Super Administrador) | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L543) |
| Usuarios y roles | custom-roles | PUT | `/v1/admin/access/custom-roles/:id` | roles:manage (Super Administrador) | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L560) |
| Usuarios y roles | permissions | GET | `/v1/admin/access/permissions` | roles:manage (Super Administrador) | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L524) |
| Usuarios y roles | roles | GET | `/v1/admin/access/roles` | roles:manage (Super Administrador) | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L520) |
| Usuarios y roles | users | GET | `/v1/admin/access/users` | roles:manage (Super Administrador) | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L585) |
| Usuarios y roles | users | POST | `/v1/admin/access/users` | roles:manage (Super Administrador) | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L606) |
| Usuarios y roles | users | PATCH | `/v1/admin/access/users/:id` | roles:manage (Super Administrador) | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L645) |
| alerts | General | GET | `/v1/admin/alerts` | alerts:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L889) |
| api usage | General | GET | `/v1/admin/api-usage` | api_usage:view | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1586) |
| audit | General | GET | `/v1/admin/audit` | audit:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1933) |
| Publicidad institucional | General | GET | `/v1/admin/banners` | advertising:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1794) |
| Publicidad institucional | General | POST | `/v1/admin/banners` | advertising:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1820) |
| Publicidad institucional | :id | PATCH | `/v1/admin/banners/:id` | advertising:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1850) |
| change password | General | POST | `/v1/admin/change-password` | Guardia indirecta | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L486) |
| Membresías y cobranzas | General | GET | `/v1/admin/collection-closures` | cash_closures:review | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1714) |
| Membresías y cobranzas | :closureId | GET | `/v1/admin/collection-closures/:closureId/commission-invoice` | settlements:review | [apps/api/src/collection-admin.ts](../apps/api/src/collection-admin.ts:L141) |
| Membresías y cobranzas | :closureId | POST | `/v1/admin/collection-closures/:closureId/commission-invoice` | settlements:review | [apps/api/src/collection-admin.ts](../apps/api/src/collection-admin.ts:L160) |
| Membresías y cobranzas | :closureId | POST | `/v1/admin/collection-closures/:closureId/commission-invoice/pay` | settlements:review | [apps/api/src/collection-admin.ts](../apps/api/src/collection-admin.ts:L203) |
| Membresías y cobranzas | :closureId | GET | `/v1/admin/collection-closures/:closureId/commission-invoice/pdf` | settlements:review | [apps/api/src/collection-admin.ts](../apps/api/src/collection-admin.ts:L150) |
| Membresías y cobranzas | :closureId | POST | `/v1/admin/collection-closures/:closureId/commission-invoice/review` | settlements:review | [apps/api/src/collection-admin.ts](../apps/api/src/collection-admin.ts:L191) |
| Membresías y cobranzas | :closureId | POST | `/v1/admin/collection-closures/:closureId/settle` | settlements:review | [apps/api/src/collection-admin.ts](../apps/api/src/collection-admin.ts:L217) |
| Membresías y cobranzas | General | GET | `/v1/admin/collection-points` | collection_points:manage | [apps/api/src/collection-admin.ts](../apps/api/src/collection-admin.ts:L66) |
| Membresías y cobranzas | General | POST | `/v1/admin/collection-points` | collection_points:manage | [apps/api/src/collection-admin.ts](../apps/api/src/collection-admin.ts:L75) |
| Membresías y cobranzas | :pointId | PATCH | `/v1/admin/collection-points/:pointId` | collection_points:manage | [apps/api/src/collection-admin.ts](../apps/api/src/collection-admin.ts:L86) |
| Membresías y cobranzas | :pointId | POST | `/v1/admin/collection-points/:pointId/collectors` | collection_points:manage | [apps/api/src/collection-admin.ts](../apps/api/src/collection-admin.ts:L114) |
| Membresías y cobranzas | :pointId | DELETE | `/v1/admin/collection-points/:pointId/collectors/:collectorId` | collection_points:manage | [apps/api/src/collection-admin.ts](../apps/api/src/collection-admin.ts:L130) |
| Membresías y cobranzas | :pointId | PATCH | `/v1/admin/collection-points/:pointId/commission` | collection_points:manage | [apps/api/src/collection-admin.ts](../apps/api/src/collection-admin.ts:L98) |
| Membresías y cobranzas | General | GET | `/v1/admin/commercial-economics` | memberships:view | [apps/api/src/commercial-economics-admin.ts](../apps/api/src/commercial-economics-admin.ts:L19) |
| Membresías y cobranzas | configuration | PUT | `/v1/admin/commercial-economics/configuration` | settings:manage | [apps/api/src/commercial-economics-admin.ts](../apps/api/src/commercial-economics-admin.ts:L43) |
| Membresías y cobranzas | dashboard | GET | `/v1/admin/commercial-economics/dashboard` | memberships:view | [apps/api/src/commercial-economics-admin.ts](../apps/api/src/commercial-economics-admin.ts:L147) |
| Membresías y cobranzas | packages | POST | `/v1/admin/commercial-economics/packages/:planId/apply-suggested-price` | membership_plans:manage | [apps/api/src/commercial-economics-admin.ts](../apps/api/src/commercial-economics-admin.ts:L90) |
| Membresías y cobranzas | packages | POST | `/v1/admin/commercial-economics/packages/:planId/recalculate` | membership_plans:manage | [apps/api/src/commercial-economics-admin.ts](../apps/api/src/commercial-economics-admin.ts:L85) |
| Membresías y cobranzas | packages | PUT | `/v1/admin/commercial-economics/packages/:planId/rules` | membership_plans:manage | [apps/api/src/commercial-economics-admin.ts](../apps/api/src/commercial-economics-admin.ts:L63) |
| Membresías y cobranzas | wallets | GET | `/v1/admin/commercial-economics/wallets` | memberships:view | [apps/api/src/commercial-economics-admin.ts](../apps/api/src/commercial-economics-admin.ts:L119) |
| Membresías y cobranzas | wallets | POST | `/v1/admin/commercial-economics/wallets/:driverId/adjust` | memberships:manage | [apps/api/src/commercial-economics-admin.ts](../apps/api/src/commercial-economics-admin.ts:L130) |
| Comercial y publicidad | advertisers | GET | `/v1/admin/commercial/advertisers` | commercial:advertisers:view | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L647) |
| Comercial y publicidad | campaigns | GET | `/v1/admin/commercial/campaigns` | commercial:campaigns:view | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L762) |
| Comercial y publicidad | campaigns | POST | `/v1/admin/commercial/campaigns/:id/action` | commercial:campaigns:review / manage según acción | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L795) |
| Comercial y publicidad | campaigns | PATCH | `/v1/admin/commercial/campaigns/:id/action-config` | commercial:campaigns:review / manage según acción | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L763) |
| Comercial y publicidad | campaigns | GET | `/v1/admin/commercial/campaigns/:id/communications` | commercial:campaigns:view | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L329) |
| Comercial y publicidad | campaigns | POST | `/v1/admin/commercial/campaigns/:id/renew` | commercial:campaigns:manage | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L772) |
| Comercial y publicidad | cash-closures | GET | `/v1/admin/commercial/cash-closures` | commercial:payments:view | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L695) |
| Comercial y publicidad | cash-closures | POST | `/v1/admin/commercial/cash-closures` | commercial:orders:manage | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L701) |
| Comercial y publicidad | cash-closures | POST | `/v1/admin/commercial/cash-closures/:id/review` | commercial:payments:review | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L716) |
| Comercial y publicidad | dashboard | GET | `/v1/admin/commercial/dashboard` | commercial:dashboard | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L565) |
| Comercial y publicidad | invitations | POST | `/v1/admin/commercial/invitations` | commercial:leads:manage | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L639) |
| Comercial y publicidad | leads | GET | `/v1/admin/commercial/leads` | commercial:leads:view | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L588) |
| Comercial y publicidad | leads | POST | `/v1/admin/commercial/leads` | commercial:leads:manage | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L608) |
| Comercial y publicidad | leads | PATCH | `/v1/admin/commercial/leads/:id` | commercial:leads:manage | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L616) |
| Comercial y publicidad | leads | POST | `/v1/admin/commercial/leads/:id/claim` | commercial:leads:manage | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L617) |
| Comercial y publicidad | orders | GET | `/v1/admin/commercial/orders` | commercial:orders:view | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L648) |
| Comercial y publicidad | orders | POST | `/v1/admin/commercial/orders/:id/payments` | commercial:orders:manage | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L649) |
| Comercial y publicidad | payment-methods | PATCH | `/v1/admin/commercial/payment-methods/:id` | commercial:plans:manage | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L801) |
| Comercial y publicidad | payments | GET | `/v1/admin/commercial/payments` | commercial:payments:view | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L673) |
| Comercial y publicidad | payments | GET | `/v1/admin/commercial/payments/:id/proof` | commercial:payments:view | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L737) |
| Comercial y publicidad | payments | POST | `/v1/admin/commercial/payments/:id/remind` | commercial:payments:review | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L674) |
| Comercial y publicidad | payments | POST | `/v1/admin/commercial/payments/:id/review` | commercial:payments:review | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L738) |
| Comercial y publicidad | plans | GET | `/v1/admin/commercial/plans` | commercial:campaigns:view | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L796) |
| Comercial y publicidad | plans | POST | `/v1/admin/commercial/plans` | commercial:plans:manage | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L797) |
| Comercial y publicidad | plans | PATCH | `/v1/admin/commercial/plans/:id` | commercial:plans:manage | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L798) |
| Comercial y publicidad | settings | GET | `/v1/admin/commercial/settings` | commercial:plans:manage | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L799) |
| Comercial y publicidad | settings | PATCH | `/v1/admin/commercial/settings` | commercial:plans:manage | [apps/api/src/commercial.ts](../apps/api/src/commercial.ts:L800) |
| console | search | GET | `/v1/admin/console/search` | Permisos por resultado (session) | [apps/api/src/admin-console.ts](../apps/api/src/admin-console.ts:L15) |
| cooperative dashboard | overview | GET | `/v1/admin/cooperative-dashboard/overview` | cooperative_dashboard:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L760) |
| cooperative dashboard | summary | GET | `/v1/admin/cooperative-dashboard/summary` | cooperative_dashboard:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L740) |
| cooperatives | General | GET | `/v1/admin/cooperatives` | cooperatives:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L690) |
| cooperatives | General | POST | `/v1/admin/cooperatives` | cooperatives:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L704) |
| cooperatives | :id | PATCH | `/v1/admin/cooperatives/:id` | cooperatives:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L719) |
| cooperatives | :id | GET | `/v1/admin/cooperatives/:id/overview` | cooperatives:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L767) |
| dashboard | General | GET | `/v1/admin/dashboard` | dashboard:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L809) |
| dashboard | details | GET | `/v1/admin/dashboard/details/:metric` | dashboard:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L829) |
| dashboard | drivers | GET | `/v1/admin/dashboard/drivers/:id` | dashboard:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L818) |
| database | General | GET | `/v1/admin/database` | database:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1944) |
| Conductores | General | GET | `/v1/admin/driver-approval-settings` | settings:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1079) |
| Conductores | General | PUT | `/v1/admin/driver-approval-settings` | settings:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1085) |
| Conductores | General | GET | `/v1/admin/driver-approvals` | REVISAR GUARDIA | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1000) |
| Conductores | :id | POST | `/v1/admin/driver-approvals/:id/decision` | drivers:approve / reject / request_corrections / suspend según decisión | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1026) |
| Conductores | :id | GET | `/v1/admin/driver-approvals/:id/history` | REVISAR GUARDIA | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1074) |
| Conductores | General | GET | `/v1/admin/drivers` | drivers:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L973) |
| Conductores | :driverId | DELETE | `/v1/admin/drivers/:driverId/documents/:documentId` | drivers:documents:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1125) |
| Conductores | :driverId | PATCH | `/v1/admin/drivers/:driverId/documents/:documentId` | drivers:documents:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1136) |
| Conductores | :id | PATCH | `/v1/admin/drivers/:id` | drivers:approve | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1150) |
| Conductores | :id | GET | `/v1/admin/drivers/:id/documents` | drivers:documents:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1095) |
| Conductores | :id | POST | `/v1/admin/drivers/:id/documents` | drivers:documents:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1107) |
| Conductores | import | POST | `/v1/admin/drivers/import/:batchId/confirm` | membership_import:manage | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1549) |
| Conductores | import | GET | `/v1/admin/drivers/import/template` | membership_import:manage | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1498) |
| Conductores | import | POST | `/v1/admin/drivers/import/validate` | membership_import:manage | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1504) |
| Soporte | General | GET | `/v1/admin/faqs` | faq:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1596) |
| Soporte | General | POST | `/v1/admin/faqs` | faq:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1600) |
| Soporte | :id | PATCH | `/v1/admin/faqs/:id` | faq:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1605) |
| Tarifas y cobertura | General | GET | `/v1/admin/fare-rules` | pricing:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1554) |
| Tarifas y cobertura | General | POST | `/v1/admin/fare-rules` | pricing:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1563) |
| Tarifas y cobertura | General | GET | `/v1/admin/fare-sectors` | pricing:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1527) |
| Tarifas y cobertura | General | POST | `/v1/admin/fare-sectors` | pricing:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1535) |
| Finanzas y facturación | clients | GET | `/v1/admin/fiscal/clients` | CLIENTES_FISCALES_VER | [apps/api/src/fiscal/routes.ts](../apps/api/src/fiscal/routes.ts:L146) |
| Finanzas y facturación | clients | GET | `/v1/admin/fiscal/clients/:id` | CLIENTES_FISCALES_VER | [apps/api/src/fiscal/routes.ts](../apps/api/src/fiscal/routes.ts:L159) |
| Finanzas y facturación | clients | GET | `/v1/admin/fiscal/clients/:id/profile` | CLIENTES_FISCALES_VER | [apps/api/src/fiscal/routes.ts](../apps/api/src/fiscal/routes.ts:L98) |
| Finanzas y facturación | clients | PUT | `/v1/admin/fiscal/clients/:id/profile` | CLIENTES_FISCALES_EDITAR | [apps/api/src/fiscal/routes.ts](../apps/api/src/fiscal/routes.ts:L170) |
| Finanzas y facturación | config | GET | `/v1/admin/fiscal/config` | FACTURACION_VER | [apps/api/src/fiscal/routes.ts](../apps/api/src/fiscal/routes.ts:L136) |
| Finanzas y facturación | config | PATCH | `/v1/admin/fiscal/config/vat` | settings:manage | [apps/api/src/fiscal/routes.ts](../apps/api/src/fiscal/routes.ts:L138) |
| Finanzas y facturación | context | GET | `/v1/admin/fiscal/context/:kind/:id` | Permiso según origen (contextOwner) | [apps/api/src/fiscal/routes.ts](../apps/api/src/fiscal/routes.ts:L101) |
| Finanzas y facturación | context | PUT | `/v1/admin/fiscal/context/:kind/:id` | Permiso según origen (contextOwner) | [apps/api/src/fiscal/routes.ts](../apps/api/src/fiscal/routes.ts:L102) |
| Finanzas y facturación | dashboard | GET | `/v1/admin/fiscal/dashboard` | FACTURACION_DASHBOARD_VER | [apps/api/src/fiscal/routes.ts](../apps/api/src/fiscal/routes.ts:L247) |
| Finanzas y facturación | invoices | GET | `/v1/admin/fiscal/invoices` | FACTURACION_VER | [apps/api/src/fiscal/routes.ts](../apps/api/src/fiscal/routes.ts:L174) |
| Finanzas y facturación | invoices | GET | `/v1/admin/fiscal/invoices/:id` | FACTURACION_VER | [apps/api/src/fiscal/routes.ts](../apps/api/src/fiscal/routes.ts:L189) |
| Finanzas y facturación | invoices | POST | `/v1/admin/fiscal/invoices/:id/:action` | Permiso fiscal según acción | [apps/api/src/fiscal/routes.ts](../apps/api/src/fiscal/routes.ts:L205) |
| Finanzas y facturación | options | GET | `/v1/admin/fiscal/options` | FACTURACION_DASHBOARD_VER | [apps/api/src/fiscal/routes.ts](../apps/api/src/fiscal/routes.ts:L97) |
| Finanzas y facturación | payments | GET | `/v1/admin/fiscal/payments` | FACTURACION_VER | [apps/api/src/fiscal/routes.ts](../apps/api/src/fiscal/routes.ts:L222) |
| fleet | files | GET | `/v1/admin/fleet/files/:id` | fleet:view (actor) | [apps/api/src/fleet/routes.ts](../apps/api/src/fleet/routes.ts:L70) |
| fleet | options | GET | `/v1/admin/fleet/options` | fleet:view (actor) | [apps/api/src/fleet/routes.ts](../apps/api/src/fleet/routes.ts:L96) |
| fleet | ownership-claims | POST | `/v1/admin/fleet/ownership-claims/:id/review` | fleet:manage (actor) | [apps/api/src/fleet/routes.ts](../apps/api/src/fleet/routes.ts:L93) |
| fleet | report | GET | `/v1/admin/fleet/report` | fleet:view (actor) | [apps/api/src/fleet/routes.ts](../apps/api/src/fleet/routes.ts:L53) |
| fleet | report | GET | `/v1/admin/fleet/report/options` | fleet:view (actor) | [apps/api/src/fleet/routes.ts](../apps/api/src/fleet/routes.ts:L52) |
| fleet | sessions | POST | `/v1/admin/fleet/sessions/:id/release` | fleet:manage (actor) | [apps/api/src/fleet/routes.ts](../apps/api/src/fleet/routes.ts:L74) |
| fleet | settings | GET | `/v1/admin/fleet/settings` | fleet:view (actor) | [apps/api/src/fleet/routes.ts](../apps/api/src/fleet/routes.ts:L115) |
| fleet | settings | PUT | `/v1/admin/fleet/settings` | fleet:manage (actor) | [apps/api/src/fleet/routes.ts](../apps/api/src/fleet/routes.ts:L116) |
| fleet | vehicles | GET | `/v1/admin/fleet/vehicles` | fleet:view (actor) | [apps/api/src/fleet/routes.ts](../apps/api/src/fleet/routes.ts:L54) |
| fleet | vehicles | POST | `/v1/admin/fleet/vehicles` | fleet:manage (actor) | [apps/api/src/fleet/routes.ts](../apps/api/src/fleet/routes.ts:L58) |
| fleet | vehicles | GET | `/v1/admin/fleet/vehicles/:id` | fleet:view (actor) | [apps/api/src/fleet/routes.ts](../apps/api/src/fleet/routes.ts:L59) |
| fleet | vehicles | PUT | `/v1/admin/fleet/vehicles/:id` | fleet:manage (actor) | [apps/api/src/fleet/routes.ts](../apps/api/src/fleet/routes.ts:L60) |
| fleet | vehicles | POST | `/v1/admin/fleet/vehicles/:id/drivers` | fleet:manage (actor) | [apps/api/src/fleet/routes.ts](../apps/api/src/fleet/routes.ts:L65) |
| fleet | vehicles | POST | `/v1/admin/fleet/vehicles/:id/files` | fleet:manage (actor) | [apps/api/src/fleet/routes.ts](../apps/api/src/fleet/routes.ts:L69) |
| fleet | vehicles | DELETE | `/v1/admin/fleet/vehicles/:id/qr` | fleet:manage (actor) | [apps/api/src/fleet/routes.ts](../apps/api/src/fleet/routes.ts:L112) |
| fleet | vehicles | POST | `/v1/admin/fleet/vehicles/:id/qr` | fleet:manage (actor) | [apps/api/src/fleet/routes.ts](../apps/api/src/fleet/routes.ts:L106) |
| fleet | vehicles | PUT | `/v1/admin/fleet/vehicles/:id/relations` | fleet:manage (actor) | [apps/api/src/fleet/routes.ts](../apps/api/src/fleet/routes.ts:L61) |
| fleet | vehicles | PUT | `/v1/admin/fleet/vehicles/:id/status` | fleet:manage (actor) | [apps/api/src/fleet/routes.ts](../apps/api/src/fleet/routes.ts:L103) |
| Soporte | General | GET | `/v1/admin/incidents` | incidents:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1449) |
| Soporte | :id | GET | `/v1/admin/incidents/:id` | incidents:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1466) |
| Soporte | :id | PATCH | `/v1/admin/incidents/:id` | incidents:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1501) |
| Soporte | :id | PATCH | `/v1/admin/incidents/:id/persist` | incidents:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1582) |
| Soporte | :incidentId | GET | `/v1/admin/incidents/:incidentId/attachments/:attachmentId` | incidents:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1493) |
| me | General | GET | `/v1/admin/me` | Guardia indirecta | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L519) |
| Membresías y cobranzas | General | GET | `/v1/admin/membership-courtesy-candidates` | memberships:manage, payments:courtesy_grant | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1399) |
| Membresías y cobranzas | General | GET | `/v1/admin/membership-grace-policies` | memberships:view | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1580) |
| Membresías y cobranzas | General | POST | `/v1/admin/membership-grace-policies` | membership_grace:manage | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1584) |
| Membresías y cobranzas | :policyId | PATCH | `/v1/admin/membership-grace-policies/:policyId/status` | membership_grace:manage | [apps/api/src/collection-admin.ts](../apps/api/src/collection-admin.ts:L238) |
| Membresías y cobranzas | preview | POST | `/v1/admin/membership-grace-policies/preview` | membership_grace:manage | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1582) |
| Membresías y cobranzas | General | GET | `/v1/admin/membership-payment-account` | settings:view | [apps/api/src/collection-admin.ts](../apps/api/src/collection-admin.ts:L38) |
| Membresías y cobranzas | General | PUT | `/v1/admin/membership-payment-account` | settings:manage | [apps/api/src/collection-admin.ts](../apps/api/src/collection-admin.ts:L46) |
| Membresías y cobranzas | :proofId | POST | `/v1/admin/membership-payments/:proofId/approve` | payments:transfer_review | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1718) |
| Membresías y cobranzas | :proofId | GET | `/v1/admin/membership-payments/:proofId/proof` | payments:transfer_review | [apps/api/src/collection-admin.ts](../apps/api/src/collection-admin.ts:L250) |
| Membresías y cobranzas | :proofId | POST | `/v1/admin/membership-payments/:proofId/reject` | payments:transfer_review | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1720) |
| Membresías y cobranzas | pending | GET | `/v1/admin/membership-payments/pending` | payments:transfer_review | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1716) |
| Membresías y cobranzas | General | GET | `/v1/admin/membership-plans` | memberships:view | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1315) |
| Membresías y cobranzas | General | POST | `/v1/admin/membership-plans` | membership_plans:manage | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1320) |
| Membresías y cobranzas | :planId | POST | `/v1/admin/membership-plans/:planId/deactivate` | membership_plans:manage | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1351) |
| Membresías y cobranzas | :planId | PATCH | `/v1/admin/membership-plans/:planId/mobile-visibility` | membership_plans:manage | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1361) |
| Membresías y cobranzas | :planId | POST | `/v1/admin/membership-plans/:planId/versions` | membership_plans:manage | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1331) |
| Membresías y cobranzas | mobile-order | PUT | `/v1/admin/membership-plans/mobile-order` | membership_plans:manage | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1374) |
| Membresías y cobranzas | General | POST | `/v1/admin/membership-topup-order` | memberships:manage | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1423) |
| Membresías y cobranzas | config | GET | `/v1/admin/membership-topup-order/config` | memberships:manage | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1417) |
| Membresías y cobranzas | General | GET | `/v1/admin/memberships` | memberships:view | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1391) |
| Membresías y cobranzas | :driverId | POST | `/v1/admin/memberships/:driverId/action` | memberships:manage, payments:courtesy_grant | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1450) |
| Membresías y cobranzas | :driverId | GET | `/v1/admin/memberships/:driverId/history` | memberships:view | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1442) |
| Membresías y cobranzas | dashboard | GET | `/v1/admin/memberships/dashboard` | memberships:view | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1435) |
| Usuarios y roles | history | GET | `/v1/admin/mobile-access/history` | roles:manage | [apps/api/src/mobile-admin-access.ts](../apps/api/src/mobile-admin-access.ts:L211) |
| Usuarios y roles | users | GET | `/v1/admin/mobile-access/users` | roles:manage | [apps/api/src/mobile-admin-access.ts](../apps/api/src/mobile-admin-access.ts:L170) |
| Usuarios y roles | users | PUT | `/v1/admin/mobile-access/users/:userId` | roles:manage | [apps/api/src/mobile-admin-access.ts](../apps/api/src/mobile-admin-access.ts:L226) |
| mobile accounts | :id | POST | `/v1/admin/mobile-accounts/:id/delete-incomplete` | mobile_accounts:delete_incomplete | [apps/api/src/mobile-account-admin.ts](../apps/api/src/mobile-account-admin.ts:L26) |
| mobile accounts | :id | PATCH | `/v1/admin/mobile-accounts/:id/identity` | mobile_accounts:edit | [apps/api/src/mobile-account-admin.ts](../apps/api/src/mobile-account-admin.ts:L17) |
| notifications | General | GET | `/v1/admin/notifications` | dashboard:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1091) |
| notifications | app-versions | GET | `/v1/admin/notifications/app-versions` | notifications:view | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L278) |
| notifications | app-versions | PUT | `/v1/admin/notifications/app-versions/:platform` | notifications:manage | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L279) |
| notifications | campaigns | GET | `/v1/admin/notifications/campaigns` | notification_campaigns:view | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L290) |
| notifications | campaigns | POST | `/v1/admin/notifications/campaigns` | notification_campaigns:manage | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L291) |
| notifications | campaigns | GET | `/v1/admin/notifications/campaigns/:id` | notification_campaigns:view | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L292) |
| notifications | campaigns | PUT | `/v1/admin/notifications/campaigns/:id` | notification_campaigns:manage | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L293) |
| notifications | campaigns | POST | `/v1/admin/notifications/campaigns/:id/cancel` | notification_campaigns:manage | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L298) |
| notifications | campaigns | POST | `/v1/admin/notifications/campaigns/:id/estimate` | notification_campaigns:view | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L294) |
| notifications | campaigns | POST | `/v1/admin/notifications/campaigns/:id/remind-pending` | notification_campaigns:manage | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L297) |
| notifications | campaigns | POST | `/v1/admin/notifications/campaigns/:id/schedule` | notification_campaigns:manage | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L296) |
| notifications | campaigns | POST | `/v1/admin/notifications/campaigns/:id/test` | notifications:test | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L295) |
| notifications | commercial-email | GET | `/v1/admin/notifications/commercial-email/campaigns` | notifications:view | [apps/api/src/commercial-email-notifications.ts](../apps/api/src/commercial-email-notifications.ts:L93) |
| notifications | commercial-email | GET | `/v1/admin/notifications/commercial-email/deliveries` | notifications:view | [apps/api/src/commercial-email-notifications.ts](../apps/api/src/commercial-email-notifications.ts:L96) |
| notifications | commercial-email | GET | `/v1/admin/notifications/commercial-email/events` | notifications:view | [apps/api/src/commercial-email-notifications.ts](../apps/api/src/commercial-email-notifications.ts:L91) |
| notifications | commercial-email | PATCH | `/v1/admin/notifications/commercial-email/events/:event` | notifications:manage | [apps/api/src/commercial-email-notifications.ts](../apps/api/src/commercial-email-notifications.ts:L92) |
| notifications | commercial-email | POST | `/v1/admin/notifications/commercial-email/preview` | notifications:view | [apps/api/src/commercial-email-notifications.ts](../apps/api/src/commercial-email-notifications.ts:L94) |
| notifications | commercial-email | POST | `/v1/admin/notifications/commercial-email/test` | notifications:test | [apps/api/src/commercial-email-notifications.ts](../apps/api/src/commercial-email-notifications.ts:L95) |
| notifications | commercial-email | GET | `/v1/admin/notifications/commercial-email/test-recipients` | notifications:test | [apps/api/src/commercial-email-notifications.ts](../apps/api/src/commercial-email-notifications.ts:L90) |
| notifications | conversion-funnel | GET | `/v1/admin/notifications/conversion-funnel` | notifications:view | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L271) |
| notifications | delivery-config | GET | `/v1/admin/notifications/delivery-config` | notifications:view | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L268) |
| notifications | delivery-config | PUT | `/v1/admin/notifications/delivery-config` | notifications:manage | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L269) |
| notifications | diagnostics | GET | `/v1/admin/notifications/diagnostics` | notifications:view | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L270) |
| notifications | health | GET | `/v1/admin/notifications/health` | notifications:view | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L267) |
| notifications | reminder-config | GET | `/v1/admin/notifications/reminder-config` | notifications:view | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L275) |
| notifications | reminder-config | PUT | `/v1/admin/notifications/reminder-config` | notifications:manage | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L276) |
| notifications | simulate | POST | `/v1/admin/notifications/simulate` | notifications:test | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L272) |
| notifications | smart | POST | `/v1/admin/notifications/smart/analyze` | notifications:manage | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L280) |
| notifications | smart | GET | `/v1/admin/notifications/smart/config` | notifications:view | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L274) |
| notifications | smart | PUT | `/v1/admin/notifications/smart/config` | notifications:manage | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L277) |
| notifications | smart | GET | `/v1/admin/notifications/smart/patterns` | notifications:view | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L281) |
| notifications | smart | GET | `/v1/admin/notifications/smart/patterns/:id` | notifications:view | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L282) |
| notifications | smart | POST | `/v1/admin/notifications/smart/patterns/:id/simulate` | notifications:test | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L283) |
| notifications | smart | POST | `/v1/admin/notifications/smart/patterns/:id/test-send` | notifications:test | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L284) |
| notifications | summary | GET | `/v1/admin/notifications/summary` | notifications:view | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L273) |
| notifications | test-send | POST | `/v1/admin/notifications/test-send` | notifications:test | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L289) |
| notifications | test-users | GET | `/v1/admin/notifications/test-users` | notifications:test | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L285) |
| notifications | test-users | POST | `/v1/admin/notifications/test-users` | notifications:test | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L287) |
| notifications | test-users | DELETE | `/v1/admin/notifications/test-users/:userId` | notifications:test | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L288) |
| notifications | test-users | GET | `/v1/admin/notifications/test-users/search` | notifications:test | [apps/api/src/smart-notifications.ts](../apps/api/src/smart-notifications.ts:L286) |
| operations | General | GET | `/v1/admin/operations` | operations:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L841) |
| operations | details | GET | `/v1/admin/operations/details/:metric` | Permisos por resultado (session) | [apps/api/src/admin-console.ts](../apps/api/src/admin-console.ts:L35) |
| passengers | General | GET | `/v1/admin/passengers` | passengers:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1184) |
| passengers | :id | PATCH | `/v1/admin/passengers/:id` | passengers:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1202) |
| passengers | :id | GET | `/v1/admin/passengers/:id/cancellation-summary` | passengers:view | [apps/api/src/passenger-cancellations.ts](../apps/api/src/passenger-cancellations.ts:L131) |
| passengers | :id | GET | `/v1/admin/passengers/:id/cancellations` | passengers:view | [apps/api/src/passenger-cancellations.ts](../apps/api/src/passenger-cancellations.ts:L138) |
| platform settings | General | GET | `/v1/admin/platform-settings` | settings:view | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1271) |
| platform settings | General | PATCH | `/v1/admin/platform-settings` | settings:manage | [apps/api/src/memberships.ts](../apps/api/src/memberships.ts:L1277) |
| Tarifas y cobertura | General | GET | `/v1/admin/pricing` | pricing:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1219) |
| Tarifas y cobertura | General | POST | `/v1/admin/pricing` | pricing:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1241) |
| Tarifas y cobertura | persist | POST | `/v1/admin/pricing/persist` | pricing:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1502) |
| push deliveries | General | GET | `/v1/admin/push-deliveries` | alerts:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L941) |
| scheduled arrival settings | General | GET | `/v1/admin/scheduled-arrival-settings` | settings:manage | [apps/api/src/scheduled-arrival.ts](../apps/api/src/scheduled-arrival.ts:L60) |
| scheduled arrival settings | General | PUT | `/v1/admin/scheduled-arrival-settings` | settings:manage | [apps/api/src/scheduled-arrival.ts](../apps/api/src/scheduled-arrival.ts:L68) |
| session | General | POST | `/v1/admin/session` | Inicio de sesión (pública) | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L427) |
| settings | General | GET | `/v1/admin/settings` | settings:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1718) |
| settings | General | PATCH | `/v1/admin/settings` | settings:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1736) |
| settings | passenger-cancellations | GET | `/v1/admin/settings/passenger-cancellations` | settings:view | [apps/api/src/passenger-cancellations.ts](../apps/api/src/passenger-cancellations.ts:L109) |
| settings | passenger-cancellations | PATCH | `/v1/admin/settings/passenger-cancellations` | settings:manage | [apps/api/src/passenger-cancellations.ts](../apps/api/src/passenger-cancellations.ts:L115) |
| trips | General | GET | `/v1/admin/trips` | trips:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1610) |
| trips | :id | POST | `/v1/admin/trips/:id/action` | trips:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1908) |
| trips | :id | GET | `/v1/admin/trips/:id/fare-audit` | trips:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1646) |
| Usuarios y roles | :id | POST | `/v1/admin/users/:id/reset-password` | users:manage | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L774) |
| Tarifas y cobertura | General | GET | `/v1/admin/zones` | service_areas:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1286) |
| Tarifas y cobertura | General | POST | `/v1/admin/zones` | service_areas:create / edit según areaId | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1349) |
| Tarifas y cobertura | :id | DELETE | `/v1/admin/zones/:id` | service_areas:archive | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1440) |
| Tarifas y cobertura | :id | GET | `/v1/admin/zones/:id/access` | service_areas:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1396) |
| Tarifas y cobertura | :id | POST | `/v1/admin/zones/:id/access` | service_areas:edit | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1404) |
| Tarifas y cobertura | :id | DELETE | `/v1/admin/zones/:id/access/:userId` | service_areas:edit | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1420) |
| Tarifas y cobertura | :id | GET | `/v1/admin/zones/:id/export` | service_areas:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1338) |
| Tarifas y cobertura | :id | GET | `/v1/admin/zones/:id/history` | service_areas:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1330) |
| Tarifas y cobertura | :id | GET | `/v1/admin/zones/:id/roles` | service_areas:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1427) |
| Tarifas y cobertura | :id | PUT | `/v1/admin/zones/:id/roles` | service_areas:edit | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1431) |
| Tarifas y cobertura | :id | PATCH | `/v1/admin/zones/:id/status` | service_areas:activate | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1387) |
| Tarifas y cobertura | validate | POST | `/v1/admin/zones/validate` | service_areas:view | [apps/api/src/admin.ts](../apps/api/src/admin.ts:L1306) |

La UI filtra módulos y submenús por permisos. La API constituye la comprobación autoritativa. `requireAdminSession` protege `/me` y cambio de clave; la búsqueda usa permisos por resultado; el acceso de flota pasa por `actor`.

## Catálogo de permisos

- `fleet:view`
- `fleet:manage`
- `FACTURACION_VER`
- `FACTURACION_ADMINISTRAR`
- `FACTURACION_CONSULTAR_ESTADO`
- `FACTURACION_REINTENTAR`
- `FACTURACION_DESCARGAR`
- `FACTURACION_REENVIAR`
- `FACTURACION_NOTA_CREDITO`
- `CLIENTES_FISCALES_VER`
- `CLIENTES_FISCALES_EDITAR`
- `FACTURACION_DASHBOARD_VER`
- `dashboard:view`
- `cooperative_dashboard:view`
- `passengers:view`
- `passengers:manage`
- `mobile_accounts:edit`
- `mobile_accounts:delete_incomplete`
- `drivers:view`
- `drivers:manage`
- `drivers:approve`
- `drivers:reject`
- `drivers:request_corrections`
- `drivers:suspend`
- `drivers:documents:view`
- `drivers:documents:manage`
- `cooperatives:view`
- `cooperatives:manage`
- `trips:view`
- `trips:manage`
- `support:view`
- `support:manage`
- `incidents:view`
- `incidents:manage`
- `reports:view`
- `reports:export`
- `reports:export_aggregated`
- `pricing:view`
- `pricing:manage`
- `zones:view`
- `zones:manage`
- `service_areas:view`
- `service_areas:create`
- `service_areas:edit`
- `service_areas:activate`
- `service_areas:archive`
- `advertising:view`
- `advertising:manage`
- `commercial:dashboard`
- `commercial:leads:view`
- `commercial:leads:manage`
- `commercial:advertisers:view`
- `commercial:advertisers:manage`
- `commercial:orders:view`
- `commercial:orders:manage`
- `commercial:payments:view`
- `commercial:payments:review`
- `commercial:campaigns:view`
- `commercial:campaigns:manage`
- `commercial:campaigns:review`
- `commercial:campaigns:approve`
- `commercial:campaigns:reject`
- `commercial:campaigns:request_correction`
- `commercial:campaigns:pause`
- `commercial:campaigns:resume`
- `commercial:campaigns:cancel`
- `commercial:plans:manage`
- `settings:view`
- `settings:manage`
- `users:manage`
- `roles:manage`
- `audit:view`
- `database:view`
- `operations:view`
- `alerts:view`
- `notifications:view`
- `notifications:manage`
- `notifications:test`
- `notification_campaigns:view`
- `notification_campaigns:manage`
- `faq:view`
- `faq:manage`
- `memberships:view`
- `memberships:manage`
- `membership_plans:manage`
- `membership_grace:manage`
- `membership_import:manage`
- `payment_orders:create`
- `payments:collect`
- `payments:transfer_review`
- `payments:view_own_point`
- `payments:view_all`
- `payments:courtesy_grant`
- `payments:reverse`
- `collection_points:manage`
- `cash_closures:create`
- `cash_closures:review`
- `settlements:create`
- `settlements:review`
- `settlements:view_own_point`
- `settlements:view_all`
- `financial_accounts:manage`
- `collection_point_limits:manage`
- `api_usage:view`

## Rol piloto: Gestión Operativa

Permisos iniciales (62): `dashboard:view`, `operations:view`, `alerts:view`, `drivers:view`, `drivers:manage`, `drivers:approve`, `drivers:reject`, `drivers:request_corrections`, `drivers:suspend`, `drivers:documents:view`, `drivers:documents:manage`, `trips:view`, `passengers:view`, `cooperatives:view`, `memberships:view`, `memberships:manage`, `membership_grace:manage`, `payment_orders:create`, `payments:collect`, `payments:transfer_review`, `payments:view_all`, `collection_points:manage`, `cash_closures:review`, `settlements:review`, `settlements:view_all`, `FACTURACION_VER`, `CLIENTES_FISCALES_VER`, `CLIENTES_FISCALES_EDITAR`, `FACTURACION_DASHBOARD_VER`, `FACTURACION_CONSULTAR_ESTADO`, `FACTURACION_REINTENTAR`, `FACTURACION_DESCARGAR`, `FACTURACION_REENVIAR`, `incidents:view`, `incidents:manage`, `support:view`, `support:manage`, `faq:view`, `faq:manage`, `commercial:dashboard`, `commercial:leads:view`, `commercial:leads:manage`, `commercial:advertisers:view`, `commercial:advertisers:manage`, `commercial:orders:view`, `commercial:orders:manage`, `commercial:payments:view`, `commercial:payments:review`, `commercial:campaigns:view`, `commercial:campaigns:manage`, `commercial:campaigns:review`, `commercial:campaigns:approve`, `commercial:campaigns:reject`, `commercial:campaigns:request_correction`, `commercial:campaigns:pause`, `commercial:campaigns:resume`, `advertising:view`, `advertising:manage`, `notification_campaigns:view`, `notification_campaigns:manage`, `reports:view`, `reports:export`.

Excluye usuarios y roles, configuración global, parámetros técnicos, tarifas, zonas, seguridad, creación de notas de crédito y modificación de IVA. El Super Administrador conserva los roles legados y acceso completo.
