import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Zone = "URBAN" | "EXTENDED";

function quote(zone: Zone, passengers: number, time: string) {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const minuteOfDay = hour * 60 + minute;
  const night = minuteOfDay >= 20 * 60 || minuteOfDay < 6 * 60;
  if (night) return { total: passengers, rule: "Tarifa nocturna por persona" };
  if (zone === "EXTENDED") return { total: passengers, rule: "Zona extendida por persona" };
  if (passengers === 3) return { total: 1, rule: "Promoción urbana diurna" };
  return { total: passengers * 0.5, rule: "Tarifa urbana diurna" };
}

function App() {
  const [zone, setZone] = useState<Zone>("URBAN");
  const [passengers, setPassengers] = useState(3);
  const [time, setTime] = useState("18:30");
  const result = useMemo(() => quote(zone, passengers, time), [zone, passengers, time]);

  return (
    <main>
      <header>
        <div>
          <span className="eyebrow">MOTOTAXI ATACAMES</span>
          <h1>Centro de control</h1>
          <p>Primera base del panel administrativo del MVP.</p>
        </div>
        <span className="status">Configuración v1 activa</span>
      </header>

      <section className="metrics">
        <article><span>Horario diurno</span><strong>06:00–19:59</strong></article>
        <article><span>Horario nocturno</span><strong>20:00–05:59</strong></article>
        <article><span>Pago</span><strong>Efectivo</strong></article>
      </section>

      <section className="grid">
        <article className="panel">
          <div className="panel-heading">
            <div><span className="eyebrow">PRUEBA DE REGLAS</span><h2>Simulador tarifario</h2></div>
          </div>
          <label>Zona
            <select value={zone} onChange={(event) => setZone(event.target.value as Zone)}>
              <option value="URBAN">Casco urbano</option>
              <option value="EXTENDED">Zona extendida</option>
            </select>
          </label>
          <label>Pasajeros
            <select value={passengers} onChange={(event) => setPassengers(Number(event.target.value))}>
              {[1, 2, 3].map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label>Hora local
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
          <div className="quote">
            <span>{result.rule}</span>
            <strong>${result.total.toFixed(2)}</strong>
            <small>Total a pagar en efectivo</small>
          </div>
        </article>

        <article className="panel">
          <span className="eyebrow">PARÁMETROS ACTIVOS</span>
          <h2>Tarifas iniciales</h2>
          <dl>
            <div><dt>Urbana de día</dt><dd>$0,50/persona</dd></div>
            <div><dt>Promoción urbana</dt><dd>3 por $1,00</dd></div>
            <div><dt>Nocturna</dt><dd>$1,00/persona</dd></div>
            <div><dt>Zona extendida</dt><dd>$1,00/persona</dd></div>
          </dl>
          <p className="note">La siguiente iteración conectará estos valores con la API y guardará versiones en PostgreSQL.</p>
        </article>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
