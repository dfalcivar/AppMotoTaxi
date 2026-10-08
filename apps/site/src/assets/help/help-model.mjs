export function uniqueArticles(articles) {
  const seen = new Set();
  return articles.filter(article => {
    const key = article.id || article.slug;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function visibleArticles(articles, audience, query) {
  const term = query.toLocaleLowerCase('es').trim();
  return uniqueArticles(articles).filter(article =>
    (!audience || article.audience === audience || article.audience === 'BOTH') &&
    (!term || [article.title, article.summary, article.body, article.category]
      .some(value => String(value || '').toLocaleLowerCase('es').includes(term)))
  );
}

export function guideSections(matches) {
  const featured = matches.filter(article => article.featured);
  const separateFeatured = matches.length >= 5 && featured.length >= 2 && matches.length - featured.length >= 2;
  const other = separateFeatured ? matches.filter(article => !article.featured) : matches;
  const groups = new Map();
  if (separateFeatured) {
    for (const article of other) {
      const label = article.category || 'Otras guías';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(article);
    }
  } else if (other.length) {
    groups.set('Guías disponibles', other);
  }
  return { featured: separateFeatured ? featured : [], groups };
}

export function instructionsFromBody(body) {
  return String(body || '').split(/\n\s*\n/).map(text => text.trim()).filter(Boolean);
}

export function shortStep(paragraph) {
  const firstSentence = paragraph.match(/^.+?[.!?](?=\s|$)/s)?.[0] || paragraph;
  if (firstSentence.length <= 140) return firstSentence;
  const cut = firstSentence.slice(0, 137).lastIndexOf(' ');
  return firstSentence.slice(0, cut > 70 ? cut : 137).trimEnd() + '…';
}
