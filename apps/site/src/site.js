const menuButton = document.querySelector('.menu-toggle');
const menu = document.querySelector('.nav-links');
const themeButton = document.querySelector('.theme-toggle');

menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!open));
  menu?.classList.toggle('open', !open);
});

document.querySelectorAll('.nav-links a').forEach(link => link.addEventListener('click', () => {
  menuButton?.setAttribute('aria-expanded', 'false');
  menu?.classList.remove('open');
}));

function activateRole(role) {
  const tab = document.querySelector(`[data-role="${role}"]`);
  if (!tab) return;
  document.querySelectorAll('[data-role]').forEach(item => item.setAttribute('aria-selected', String(item === tab)));
  document.querySelectorAll('.role-panel').forEach(panel => {
    const active = panel.id === `${role}-panel`;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  const screen = document.querySelector('#role-screen');
  if (screen) {
    const isDriver = role === 'driver';
    screen.classList.toggle('driver-mode', isDriver);
    screen.classList.toggle('passenger-mode', !isDriver);
    screen.setAttribute('aria-label', isDriver
      ? 'Interfaz ilustrativa de Costa-Go para conductor'
      : 'Interfaz ilustrativa de Costa-Go para pasajero');

    const roleContent = isDriver
      ? {
          welcome: 'Modo conductor',
          greeting: 'Hola',
          question: 'Disponible para viajes',
          'search-copy': 'Mototaxi activa · MT-2',
          'state-icon': '✓',
          'state-title': 'Listo para recibir solicitudes',
          'state-copy': 'Ubicación activa y unidad verificada',
        }
      : {
          welcome: 'Bienvenido',
          greeting: 'Hola, usuario',
          question: '¿A dónde vamos?',
          'search-copy': 'Busca tu destino',
          'state-icon': '⌖',
          'state-title': 'Viaja con tranquilidad',
          'state-copy': 'Origen, destino y tarifa clara',
        };

    Object.entries(roleContent).forEach(([key, value]) => {
      const element = document.querySelector(`#role-${key}`);
      if (element) element.textContent = value;
    });
  }
}

document.querySelectorAll('[data-role]').forEach(tab => tab.addEventListener('click', () => activateRole(tab.dataset.role)));
document.querySelectorAll('[data-open-role]').forEach(link => link.addEventListener('click', () => activateRole(link.dataset.openRole)));

const savedTheme = localStorage.getItem('costa-go-theme');
document.documentElement.dataset.theme = savedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
function updateThemeLabel() {
  if (!themeButton) return;
  const isDark = document.documentElement.dataset.theme === 'dark';
  themeButton.setAttribute('aria-label', isDark ? 'Activar tema claro' : 'Activar tema oscuro');
  themeButton.setAttribute('title', isDark ? 'Activar tema claro' : 'Activar tema oscuro');
}
updateThemeLabel();
themeButton?.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('costa-go-theme', next);
  updateThemeLabel();
});

const observer = new IntersectionObserver(entries => entries.forEach(entry => {
  if (entry.isIntersecting) {
    entry.target.classList.add('visible');
    observer.unobserve(entry.target);
  }
}), { threshold: .12 });
document.querySelectorAll('.reveal').forEach(element => observer.observe(element));

document.querySelectorAll('.accordion details').forEach(item => item.addEventListener('toggle', () => {
  if (!item.open) return;
  document.querySelectorAll('.accordion details').forEach(other => {
    if (other !== item) other.open = false;
  });
}));

document.querySelector('#year').textContent = new Date().getFullYear();

const commercialLauncher = document.querySelector('#commercial-assistant-launcher');
const commercialPanel = document.querySelector('#commercial-assistant-panel');
const commercialClose = document.querySelector('#commercial-assistant-close');
const commercialFrame = commercialPanel?.querySelector('iframe');
function setCommercialAssistant(open) {
  if (!commercialPanel || !commercialLauncher) return;
  if (open && commercialFrame && !commercialFrame.hasAttribute('src')) commercialFrame.setAttribute('src', commercialFrame.dataset.src);
  commercialPanel.hidden = !open;
  commercialLauncher.setAttribute('aria-expanded', String(open));
  if (!open && commercialFrame?.hasAttribute('src')) commercialFrame.removeAttribute('src');
}
commercialLauncher?.addEventListener('click', () => setCommercialAssistant(commercialPanel?.hidden !== false));
commercialClose?.addEventListener('click', () => setCommercialAssistant(false));
