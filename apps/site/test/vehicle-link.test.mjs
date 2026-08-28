import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const script=await readFile(new URL('../src/vehicle-link.js',import.meta.url),'utf8');
function render(token){const elements={'open-vehicle':{hidden:true},'vehicle-message':{textContent:''}};runInNewContext(script,{URL,location:{href:`https://costa-go.com/vehicle.html?token=${encodeURIComponent(token)}`},document:{getElementById:id=>elements[id]}});return elements;}
test('valid opaque QR offers explicit app navigation without exposing personal data',()=>{const token='a'.repeat(43),page=render(token);assert.equal(page['open-vehicle'].href,`costa-go://vehicle/${token}`);assert.equal(page['open-vehicle'].hidden,false);});
test('malformed tokens cannot inject navigation',()=>{for(const token of ['', 'MT-2','javascript:alert(1)','a'.repeat(44)]){const page=render(token);assert.equal(page['open-vehicle'].hidden,true);assert.equal(page['open-vehicle'].href,undefined);assert.match(page['vehicle-message'].textContent,/no es válido/);}});
test('QR landing prevents referrer/token leakage and indexing',async()=>{const html=await readFile(new URL('../src/vehicle.html',import.meta.url),'utf8');assert.match(html,/name="referrer" content="no-referrer"/);assert.match(html,/noindex,nofollow/);assert.doesNotMatch(html,/analytics|googletagmanager/);});
