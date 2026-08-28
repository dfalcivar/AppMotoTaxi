// Development-only entrypoint. Not included in the Vite production build.
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FiscalAdmin} from '../src/fiscal-admin.js';
import '../src/styles.css';
import '../src/admin-enhancements.css';
import '../src/brand.css';
function Preview(){const [session,setSession]=useState<any>();useEffect(()=>{fetch('/api/qa/session').then(r=>r.json()).then(setSession);},[]);return <main style={{maxWidth:1200,margin:'auto',padding:20}}><p>PRUEBA LOCAL · DATOS FICTICIOS · SIN EMISIÓN</p><h1>Finanzas / Facturación</h1>{session?<FiscalAdmin token={session.token} permissions={session.permissions}/>:<p>Cargando prueba…</p>}</main>;}
createRoot(document.getElementById('root')!).render(<Preview/>);
