// Local UI fixture only; not an entry point of the production build.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {FleetAdmin} from '../src/fleet-admin';
import '../src/styles.css';
import '../src/brand.css';
async function main(){
  if(!['localhost','127.0.0.1'].includes(location.hostname))throw Error('Local fixture only');
  const response=await fetch('http://127.0.0.1:3313/qa/session');
  const session=await response.json();
  createRoot(document.getElementById('root')!).render(<main style={{padding:24}}><h1>Mototaxis · Prueba local</h1><FleetAdmin token={session.token} permissions={['fleet:view','fleet:manage']}/></main>);
}
void main();
