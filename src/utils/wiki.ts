import type { Language } from '../types.js';

/**
 * Prefixos de namespaces não permitidos como artigos válidos durante a partida.
 */
export const FORBIDDEN_NAMESPACE_PREFIXES = [
  'Special:',
  'Especial:',
  'Category:',
  'Categoria:',
  'File:',
  'Ficheiro:',
  'Imagem:',
  'Wikipedia:',
  'Wikipédia:',
  'Help:',
  'Ajuda:',
  'Portal:',
  'Template:',
  'Predefinição:',
  'Talk:',
  'Discussão:',
  'User:',
  'Usuário:',
  'Usuária:',
  'Module:',
  'Módulo:',
  'MediaWiki:',
  'Draft:',
  'TimedText:',
];

const FORBIDDEN_EXACT_TITLES = new Set([
  'Main Page',
  'Main_Page',
  'Página principal',
  'Página_principal',
  'Wikipédia:Página principal',
  'Wikipédia:Página_principal',
]);

export function normalizeArticleTitle(raw: string): string {
  try {
    return decodeURIComponent(raw).replace(/_/g, ' ').trim();
  } catch {
    return raw.replace(/_/g, ' ').trim();
  }
}

export function isWikipediaHostname(hostname: string, expectedLang?: Language): boolean {
  const lower = hostname.toLowerCase();
  if (expectedLang) {
    return (
      lower === `${expectedLang}.wikipedia.org` || lower === `${expectedLang}.m.wikipedia.org`
    );
  }
  return lower.endsWith('.wikipedia.org');
}

/**
 * Extrai o título do artigo a partir de uma URL da Wikipédia (`/wiki/Titulo`).
 * Retorna `null` se não for uma rota `/wiki/` válida.
 */
export function extractTitleFromWikiUrl(urlString: string, expectedLang?: Language): string | null {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return null;
  }

  if (!isWikipediaHostname(parsed.hostname, expectedLang)) {
    return null;
  }

  if (!parsed.pathname.startsWith('/wiki/')) {
    return null;
  }

  const rawSlug = parsed.pathname.slice('/wiki/'.length);
  if (!rawSlug) {
    return null;
  }

  return normalizeArticleTitle(rawSlug);
}

/**
 * Verifica se um título pertence ao namespace principal de artigos (sem prefixos proibidos).
 */
export function isAllowedArticleTitle(rawTitle: string): boolean {
  const clean = normalizeArticleTitle(rawTitle);
  if (!clean || FORBIDDEN_EXACT_TITLES.has(clean)) {
    return false;
  }

  const lower = clean.toLowerCase();
  for (const prefix of FORBIDDEN_NAMESPACE_PREFIXES) {
    if (lower.startsWith(prefix.toLowerCase())) {
      return false;
    }
  }

  return true;
}

/**
 * Verifica se duas URLs diferem apenas pela âncora (`#seção`), mantendo o mesmo `origin` e `pathname`.
 */
export function isSameArticleAnchorChange(urlA: string, urlB: string): boolean {
  try {
    const a = new URL(urlA);
    const b = new URL(urlB);
    return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
  } catch {
    return false;
  }
}

/**
 * Avalia se um atributo `href` de um elemento `<a>` na página da Wikipédia é permitido durante a partida.
 * - Links de âncora pura (`#secao`) na mesma página são permitidos.
 * - Links internos `/wiki/<Artigo>` do mesmo idioma e sem prefixos proibidos são permitidos.
 * - Todos os demais (`Especial:`, `Categoria:`, `Ficheiro:`, `/w/index.php`, links externos ou interwiki) são bloqueados.
 */
export function isAllowedWikiLinkHref(
  href: string,
  currentPageUrl: string,
  activeLang: Language
): boolean {
  const trimmed = href.trim();
  if (!trimmed) return false;

  if (trimmed.startsWith('#')) {
    return true;
  }

  let resolved: URL;
  let current: URL;
  try {
    current = new URL(currentPageUrl);
    resolved = new URL(trimmed, currentPageUrl);
  } catch {
    return false;
  }

  // Se for mudança apenas de hash na mesma página, permite
  if (
    resolved.origin === current.origin &&
    resolved.pathname === current.pathname &&
    resolved.search === current.search &&
    resolved.hash.length > 0
  ) {
    return true;
  }

  // Bloqueia URLs com query string (como /w/index.php?title=...&action=edit)
  if (resolved.search.length > 0) {
    return false;
  }

  const title = extractTitleFromWikiUrl(resolved.toString(), activeLang);
  if (!title) {
    return false;
  }

  return isAllowedArticleTitle(title);
}
