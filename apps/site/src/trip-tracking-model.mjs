const terminalStatuses = new Set(['COMPLETED', 'CANCELLED', 'NO_DRIVER']);
const activeStatuses = new Set(['ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS']);

export function validPosition(location) {
  return location && typeof location.latitude === 'number' && typeof location.longitude === 'number' &&
    Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90 &&
    Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180 &&
    location.updatedAt != null && Number.isFinite(Date.parse(location.updatedAt));
}

export function trackingView(data, elapsedMs = 0, disconnected = false, receivedAt = Date.now()) {
  const trip = data.trip;
  if (trip.terminal || terminalStatuses.has(trip.status)) return {
    terminal: true, position: null, tone: 'ended', title: 'Seguimiento finalizado',
    copy: 'El seguimiento terminó junto con el viaje. Ya no se comparte la ubicación.',
  };
  const position = activeStatuses.has(trip.status) && validPosition(trip.location) ? trip.location : null;
  const serverNow = Date.parse(data.serverTime);
  const age = position ? Math.max(0, (Number.isFinite(serverNow) ? serverNow : receivedAt) + elapsedMs - Date.parse(position.updatedAt)) : Infinity;
  const freshness = Math.max(15, Number(data.locationFreshnessSeconds) || 60) * 1000;
  if (disconnected) return { terminal: false, position, tone: 'waiting', title: 'Reconectando…',
    copy: 'No pudimos actualizar el viaje. Reintentamos automáticamente; la posición puede haber cambiado.' };
  if (!position) return { terminal: false, position: null, tone: 'waiting', title: 'Esperando ubicación',
    copy: 'El mapa aparecerá cuando el conductor comparta su posición para este viaje.' };
  if (age > freshness) return { terminal: false, position, tone: 'waiting', title: 'Sin señal reciente',
    copy: 'Esta es la última ubicación recibida, no una posición en vivo. Se actualizará cuando regrese la señal.' };
  return { terminal: false, position, tone: 'live', title: 'Seguimiento en vivo',
    copy: 'La mototaxi se actualiza automáticamente con la ubicación que envía el conductor.' };
}

export function refreshDelay(seconds) {
  return Math.min(60, Math.max(10, Number(seconds) || 15)) * 1000;
}
