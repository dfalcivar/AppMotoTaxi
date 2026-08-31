const menuButton = document.querySelector('.menu');
const links = document.querySelector('.links');
menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!open)); links?.classList.toggle('open', !open);
});
links?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => { menuButton?.setAttribute('aria-expanded','false'); links.classList.remove('open'); }));

const form = document.querySelector('#demo-form');
const status = document.querySelector('#form-status');
form?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const button = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  const payload = Object.fromEntries(data.entries());
  payload.unitCount = Number(payload.unitCount);
  payload.submissionKey = crypto.randomUUID();
  button.disabled = true; button.textContent = 'Enviando…'; status.className = 'form-status'; status.textContent = '';
  try {
    const base = window.COSTA_GO_PUBLIC_CONFIG?.apiBaseUrl || 'https://mototaxi-atacames-api.onrender.com';
    const response = await fetch(`${base}/v1/public/cooperative-demo-requests`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    if (!response.ok) throw new Error(response.status === 429 ? 'TOO_MANY' : 'FAILED');
    const result = await response.json();
    form.reset(); status.className = 'form-status success'; status.textContent = `Solicitud recibida. Tu código es ${result.requestCode}. Un asesor se comunicará contigo.`;
  } catch (error) {
    status.className = 'form-status error'; status.textContent = error.message === 'TOO_MANY' ? 'Has realizado varios intentos. Espera unos minutos y vuelve a intentarlo.' : 'No pudimos enviar la solicitud. Intenta nuevamente o escribe a soporte@costa-go.com.';
  } finally { button.disabled = false; button.textContent = 'Solicitar demostración'; }
});
