export function referralLocation(location) {
  const code=decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1)??'').toUpperCase();
  const program=new URLSearchParams(location.search).get('p')??'';
  if(!/^CG-[A-F0-9]{16}$/.test(code)||(program&&!/^[A-Z][A-Z0-9_]{2,79}$/.test(program)))return null;
  return {code,program,deepLink:`costa-go://referral/${code}${program?'?p='+encodeURIComponent(program):''}`};
}
export function appleStoreLink(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='apps.apple.com'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
