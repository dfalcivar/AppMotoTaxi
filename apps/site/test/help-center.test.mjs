import test from 'node:test';
import assert from 'node:assert/strict';
import { guideSections, instructionsFromBody, shortStep, visibleArticles } from '../src/assets/help/help-model.mjs';

const guide = (id, overrides = {}) => ({ id, slug: `guia-${id}`, title: `Guía ${id}`, summary: 'Aprende los pasos', body: 'Primer paso. Segundo detalle.', audience: 'DRIVER', category: 'Mototaxis', featured: false, ...overrides });

test('one published tutorial appears only once when it is also featured', () => {
  const matches = visibleArticles([guide(1, { featured: true }), guide(1, { featured: true })], '', '');
  const sections = guideSections(matches);
  assert.equal(matches.length, 1);
  assert.equal(sections.featured.length, 0);
  assert.deepEqual([...sections.groups.values()].flat().map(item => item.id), [1]);
});

test('featured guides are excluded from dynamic category sections when there is enough content', () => {
  const matches = [guide(1, { featured: true }), guide(2, { featured: true }), guide(3), guide(4, { category: 'Viajes' }), guide(5, { audience: 'PASSENGER' })];
  const sections = guideSections(matches);
  const ids = [...sections.featured, ...[...sections.groups.values()].flat()].map(item => item.id);
  assert.deepEqual(ids.sort(), [1, 2, 3, 4, 5]);
  assert.equal(new Set(ids).size, 5);
  assert.deepEqual([...sections.groups.keys()], ['Mototaxis', 'Viajes']);
});

test('audience and search preserve published guide filtering', () => {
  const articles = [guide(1), guide(2, { audience: 'PASSENGER', category: 'Pagos' }), guide(3, { audience: 'BOTH', title: 'Recargas' })];
  assert.deepEqual(visibleArticles(articles, 'PASSENGER', '').map(item => item.id), [2, 3]);
  assert.deepEqual(visibleArticles(articles, '', 'pagos').map(item => item.id), [2]);
});

test('quick steps never remove the complete instructions', () => {
  const body = 'Entra a Mi perfil. Allí verás tus unidades.\n\nSube una foto clara donde se lea el número de la mototaxi. Después envía la solicitud.';
  const paragraphs = instructionsFromBody(body);
  assert.equal(paragraphs.join('\n\n'), body);
  assert.deepEqual(paragraphs.map(shortStep), ['Entra a Mi perfil.', 'Sube una foto clara donde se lea el número de la mototaxi.']);
});
