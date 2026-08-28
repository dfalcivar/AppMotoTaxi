// Loopback-only UI preview. Uses the real React components and test-only PGlite API.
import {createServer} from '../apps/admin/node_modules/vite/dist/node/index.js';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const site=resolve(repo,'apps/site/src');
const vite=await createServer({configFile:false,root:resolve(repo,'apps/admin'),esbuild:{jsx:'automatic'},plugins:[{name:'fiscal-proof-preview',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/config.js'){res.setHeader('Content-Type','text/javascript');res.end('window.COSTA_GO_PUBLIC_CONFIG={apiBaseUrl:"/api"};');return;}
  if(url.pathname.startsWith('/anunciarme/')||url.pathname.startsWith('/assets/')){
    let path=url.pathname;if(path==='/anunciarme/comprobante/')path+='index.html';
    const file=resolve(site,'.'+path);if(!file.startsWith(site+String.fromCharCode(92))&&!file.startsWith(site+'/'))return next();
    try{const body=await readFile(file);res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':'text/html');res.end(body);}catch{next();}return;
  }next();
});}}],server:{host:'127.0.0.1',port:3310,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:3311',rewrite:p=>p.replace(/^\/api/,'')}}},define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api')}});
await vite.listen();vite.printUrls();
