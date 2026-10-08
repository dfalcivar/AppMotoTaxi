import { guideSections, instructionsFromBody, shortStep, uniqueArticles, visibleArticles } from './help-model.mjs';

const api = (window.COSTA_GO_PUBLIC_CONFIG?.apiBaseUrl || 'https://mototaxi-atacames-api.onrender.com').replace(/\/$/, '');
const $ = id => document.getElementById(id);
const asset = value => value?.startsWith('/v1/') ? api + value : value;
const audienceName = value => value === 'DRIVER' ? 'Conductores' : value === 'PASSENGER' ? 'Pasajeros' : 'Para todos';
async function get(path) {
  const response = await fetch(api + path);
  if (!response.ok) throw new Error('No se pudo consultar el contenido.');
  return response.json();
}

function card(article) {
  const link = document.createElement('a');
  link.className = 'guide-card';
  link.href = '/ayuda/' + encodeURIComponent(article.slug);
  const visual = document.createElement('span');
  visual.className = 'card-visual';
  if (article.coverUrl) {
    const image = document.createElement('img');
    image.src = asset(article.coverUrl);
    image.alt = '';
    visual.append(image);
  } else {
    visual.textContent = article.videoUrl ? '▶' : '▤';
    visual.setAttribute('aria-hidden', 'true');
  }
  const copy = document.createElement('span');
  copy.className = 'card-copy';
  const label = document.createElement('small');
  label.textContent = audienceName(article.audience) + (article.category ? ' · ' + article.category : '');
  const title = document.createElement('strong');
  title.textContent = article.title;
  const summary = document.createElement('span');
  summary.textContent = article.summary;
  const format = document.createElement('span');
  format.className = 'card-format';
  format.textContent = [article.videoUrl && 'Video', article.pdfUrl && 'PDF'].filter(Boolean).join(' · ');
  copy.append(label, title, summary, format);
  const more = document.createElement('em');
  more.textContent = 'Ver tutorial →';
  link.append(visual, copy, more);
  return link;
}

let articles = [];
let audience = '';
function render() {
  const matches = visibleArticles(articles, audience, $('search').value);
  const { featured, groups } = guideSections(matches);
  $('featured').hidden = featured.length === 0;
  $('featured-cards').replaceChildren(...featured.map(card));
  const sections = [];
  for (const [name, items] of groups) {
    const section = document.createElement('section');
    section.className = 'category';
    if (featured.length) {
      const heading = document.createElement('h3');
      heading.textContent = name;
      section.append(heading);
    }
    const cards = document.createElement('div');
    cards.className = 'cards';
    cards.append(...items.map(card));
    section.append(cards);
    sections.push(section);
  }
  $('categories').replaceChildren(...sections);
  $('list-status').textContent = matches.length ? '' : 'No hay guías publicadas para esta búsqueda.';
}

function showAudiences() {
  const hasDriver = articles.some(article => article.audience === 'DRIVER' || article.audience === 'BOTH');
  const hasPassenger = articles.some(article => article.audience === 'PASSENGER' || article.audience === 'BOTH');
  document.querySelector('[data-audience="DRIVER"]').hidden = !hasDriver;
  document.querySelector('[data-audience="PASSENGER"]').hidden = !hasPassenger;
  document.querySelector('.audiences').hidden = !hasDriver && !hasPassenger;
}

async function listing() {
  try {
    articles = uniqueArticles(await get('/v1/help/articles'));
    showAudiences();
    render();
    const faqs = await get('/v1/help/faqs').catch(() => []);
    const shown = faqs.filter(item => Array.isArray(item.audiences) && item.audiences.length);
    $('faq').hidden = !shown.length;
    $('faq-items').replaceChildren(...shown.map(item => {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = item.question;
      const answer = document.createElement('p');
      answer.textContent = item.answer;
      details.append(summary, answer);
      return details;
    }));
    if (location.hash === '#faq' && shown.length) requestAnimationFrame(() => $('faq').scrollIntoView());
  } catch {
    $('list-status').textContent = 'No se pudieron cargar las guías. Intenta nuevamente más tarde.';
  }
}

async function detail(slug) {
  $('listing').hidden = true;
  $('detail').hidden = false;
  try {
    const article = await get('/v1/help/articles/' + encodeURIComponent(slug));
    document.title = article.title + ' | Costa-Go';
    $('article-category').textContent = audienceName(article.audience) + (article.category ? ' · ' + article.category : '');
    $('article-title').textContent = article.title;
    $('article-summary').textContent = article.summary;
    const instructions = instructionsFromBody(article.body);
    $('steps-block').hidden = !instructions.length;
    $('quick-steps').replaceChildren(...instructions.map(text => {
      const step = document.createElement('li');
      step.textContent = shortStep(text);
      return step;
    }));
    $('instructions').hidden = !instructions.length;
    $('article-body').replaceChildren(...instructions.map(text => {
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      return paragraph;
    }));
    if (article.videoUrl) {
      $('video-block').hidden = false;
      $('article-video').src = asset(article.videoUrl);
    }
    if (article.pdfUrl) {
      const url = asset(article.pdfUrl);
      $('pdf-block').hidden = false;
      $('pdf-view').href = url;
      $('pdf-download').href = article.pdfUrl.startsWith('/v1/') ? url + '?download=1' : url;
    }
  } catch {
    $('article-title').textContent = 'Tutorial no disponible';
    $('article-summary').textContent = 'Puede haber sido ocultado o la dirección no existe.';
    $('instructions').hidden = true;
  }
}

const slug = decodeURIComponent(location.pathname.replace(/^\/ayuda\/?/, '').replace(/\/$/, ''));
if (slug) {
  detail(slug);
} else {
  listing();
  $('search').addEventListener('input', render);
  document.querySelectorAll('[data-audience]').forEach(button => button.addEventListener('click', () => {
    audience = button.dataset.audience;
    document.querySelectorAll('[data-audience]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    render();
  }));
}
