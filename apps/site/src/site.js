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

document.querySelectorAll('[data-role]').forEach(tab => tab.addEventListener('click', () => {
  const role = tab.dataset.role;
  document.querySelectorAll('[data-role]').forEach(item => item.setAttribute('aria-selected', String(item === tab)));
  document.querySelectorAll('.role-panel').forEach(panel => {
    const active = panel.id === `${role}-panel`;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
}));

const savedTheme = localStorage.getItem('costa-go-theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
themeButton?.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('costa-go-theme', next);
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
  if (open && commercialFrame && !commercialFrame.src) commercialFrame.src = commercialFrame.dataset.src;
  commercialPanel.hidden = !open;
  commercialLauncher.setAttribute('aria-expanded', String(open));
  commercialLauncher.querySelector('span').textContent = open ? 'Ocultar asistente' : 'Anuncia tu negocio';
}
commercialLauncher?.addEventListener('click', () => setCommercialAssistant(commercialPanel?.hidden !== false));
commercialClose?.addEventListener('click', () => setCommercialAssistant(false));
