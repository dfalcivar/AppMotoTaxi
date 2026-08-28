const token=new URL(location.href).searchParams.get('token');
const link=document.getElementById('open-vehicle');
if(token&&/^[A-Za-z0-9_-]{43}$/.test(token)){link.href=`costa-go://vehicle/${token}`;link.hidden=false;}
else document.getElementById('vehicle-message').textContent='El enlace no es válido. Solicita el QR vigente al responsable de la unidad.';
