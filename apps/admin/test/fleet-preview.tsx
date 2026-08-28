// Local UI fixture only; not an entry point of the production build.
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FleetAdmin} from '../src/fleet-admin';
import '../src/styles.css';
import '../src/brand.css';
function Preview({token}:{token:string}){
  const [dark,setDark]=useState(false);
  return <main data-fleet-theme={dark?'dark':'light'} style={{padding:24,background:dark?'#101820':'#edf3f4',color:dark?'#e1eaf2':'#032b49',minHeight:'100vh'}}>
    <button onClick={()=>setDark(v=>!v)}>Tema {dark?'claro':'oscuro'}</button>
    <h1>Mototaxis · Prueba local</h1><p>Datos sintéticos. Los cuadros de color prueban la carga de imágenes; no representan mototaxis reales.</p>
    <FleetAdmin token={token} permissions={['fleet:view','fleet:manage']}/></main>;
}
async function main(){
  if(!['localhost','127.0.0.1'].includes(location.hostname))throw Error('Local fixture only');
  const response=await fetch('http://127.0.0.1:3313/qa/session');
  const session=await response.json();
  createRoot(document.getElementById('root')!).render(<Preview token={session.token}/>);
}
void main();
