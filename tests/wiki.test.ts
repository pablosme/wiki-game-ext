import { describe, expect, it } from 'vitest';
import {
  extractTitleFromWikiUrl,
  isAllowedArticleTitle,
  isAllowedWikiLinkHref,
  isSameArticleAnchorChange,
} from '../src/utils/wiki.js';

describe('wikipedia-game-ext — sanitização e validação de links', () => {
  it('extrai e normaliza títulos canônicos a partir de URLs da Wikipédia', () => {
    expect(
      extractTitleFromWikiUrl('https://pt.wikipedia.org/wiki/Segunda_Guerra_Mundial', 'pt')
    ).toBe('Segunda Guerra Mundial');

    expect(extractTitleFromWikiUrl('https://en.wikipedia.org/wiki/Albert_Einstein', 'pt')).toBeNull();
  });

  it('bloqueia títulos pertencentes a namespaces proibidos (Especial, Categoria, Ficheiro)', () => {
    expect(isAllowedArticleTitle('Brasil')).toBe(true);
    expect(isAllowedArticleTitle('Especial:Pesquisar')).toBe(false);
    expect(isAllowedArticleTitle('Categoria:História do Brasil')).toBe(false);
    expect(isAllowedArticleTitle('Ficheiro:Bandeira.svg')).toBe(false);
    expect(isAllowedArticleTitle('Special:Random')).toBe(false);
  });

  it('permite âncoras internas (#seção) e artigos válidos do mesmo idioma', () => {
    const currentUrl = 'https://pt.wikipedia.org/wiki/Brasil';

    expect(isAllowedWikiLinkHref('#História', currentUrl, 'pt')).toBe(true);
    expect(isAllowedWikiLinkHref('/wiki/Portugal', currentUrl, 'pt')).toBe(true);
    expect(isAllowedWikiLinkHref('/wiki/Especial:Aleatória', currentUrl, 'pt')).toBe(false);
    expect(isAllowedWikiLinkHref('/wiki/Categoria:Países', currentUrl, 'pt')).toBe(false);
    expect(isAllowedWikiLinkHref('/w/index.php?title=Brasil&action=edit', currentUrl, 'pt')).toBe(
      false
    );
    expect(isAllowedWikiLinkHref('https://en.wikipedia.org/wiki/Brazil', currentUrl, 'pt')).toBe(
      false
    );
  });

  it('identifica mudanças apenas de âncora (#hash) no mesmo artigo', () => {
    expect(
      isSameArticleAnchorChange(
        'https://pt.wikipedia.org/wiki/Brasil',
        'https://pt.wikipedia.org/wiki/Brasil#Geografia'
      )
    ).toBe(true);

    expect(
      isSameArticleAnchorChange(
        'https://pt.wikipedia.org/wiki/Brasil',
        'https://pt.wikipedia.org/wiki/Portugal'
      )
    ).toBe(false);
  });
});
