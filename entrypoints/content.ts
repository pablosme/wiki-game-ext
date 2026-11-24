import { defineContentScript } from 'wxt/sandbox';
import type { ActiveMatchState, ExtensionMessage, Language } from '../src/types.js';
import { SESSION_STORAGE_KEY } from '../src/utils/storage.js';
import {
  extractTitleFromWikiUrl,
  isAllowedWikiLinkHref,
  normalizeArticleTitle,
} from '../src/utils/wiki.js';

const DOM_LOCK_STYLE_ID = 'wiki-game-dom-lock-style';

const DOM_LOCK_CSS = `
  /* Oculta barra de pesquisa da Wikipédia */
  #p-search,
  #searchInput,
  #searchform,
  .vector-search-box,
  .cdx-search-input,
  .mw-header .vector-search-box-vue,
  /* Oculta menus laterais e barras de ferramentas de navegação global */
  #mw-panel,
  #mw-navigation,
  #vector-main-menu-dropdown,
  #vector-main-menu,
  .vector-header-start .vector-dropdown,
  .vector-page-toolbar,
  #vector-page-tools-pinned-container,
  #p-navigation,
  #p-interaction,
  #p-tb,
  #p-coll-print_export,
  #p-wikibase-otherprojects,
  .vector-sticky-header,
  #ca-talk,
  #ca-edit,
  #ca-ve-edit,
  #ca-history,
  #ca-viewsource,
  .mw-editsection,
  /* Oculta seletores e links de idioma (interwiki) */
  #p-lang,
  #p-lang-btn,
  .mw-interlanguage-selector,
  .vector-page-titlebar .mw-interlanguage-selector,
  /* Oculta rodapé */
  #footer,
  .mw-footer {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
  }

  /* Estilo visual para links desabilitados pelo Wikipedia Game */
  a[data-wiki-game-disabled="true"] {
    pointer-events: none !important;
    cursor: not-allowed !important;
    color: #72777d !important;
    text-decoration: none !important;
    opacity: 0.65;
  }
`;

function extractCanonicalTitle(expectedLang?: Language): string | null {
  const canonicalLink = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (canonicalLink?.href) {
    const fromCanonical = extractTitleFromWikiUrl(canonicalLink.href, expectedLang);
    if (fromCanonical) {
      return fromCanonical;
    }
  }

  const heading = document.querySelector<HTMLElement>('#firstHeading .mw-page-title-main');
  if (heading?.textContent) {
    return normalizeArticleTitle(heading.textContent);
  }

  return extractTitleFromWikiUrl(window.location.href, expectedLang);
}

function detectDisambiguationPage(): boolean {
  return Boolean(
    document.querySelector(
      '#disambigbox, .dmbox-disambig, table.dmbox, a[href*=":Desambigua"], a[href*=":Disambiguation"]'
    )
  );
}

function applyDomLockStyle(): void {
  if (document.getElementById(DOM_LOCK_STYLE_ID)) return;
  const styleEl = document.createElement('style');
  styleEl.id = DOM_LOCK_STYLE_ID;
  styleEl.textContent = DOM_LOCK_CSS;
  (document.head || document.documentElement).appendChild(styleEl);
}

function removeDomLockStyle(): void {
  const existing = document.getElementById(DOM_LOCK_STYLE_ID);
  if (existing) {
    existing.remove();
  }
}

function sanitizePageLinks(activeLang: Language): void {
  const currentUrl = window.location.href;
  const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href]');

  for (const anchor of anchors) {
    const rawHref = anchor.getAttribute('href');
    if (!rawHref) continue;

    if (anchor.hasAttribute('target')) {
      anchor.removeAttribute('target');
    }

    const allowed = isAllowedWikiLinkHref(rawHref, currentUrl, activeLang);
    if (!allowed) {
      anchor.setAttribute('data-wiki-game-disabled', 'true');
      anchor.setAttribute('aria-disabled', 'true');
      anchor.tabIndex = -1;
    } else if (anchor.hasAttribute('data-wiki-game-disabled')) {
      anchor.removeAttribute('data-wiki-game-disabled');
      anchor.removeAttribute('aria-disabled');
      anchor.removeAttribute('tabindex');
    }
  }
}

function restorePageLinks(): void {
  const disabledAnchors = document.querySelectorAll<HTMLAnchorElement>(
    'a[data-wiki-game-disabled="true"]'
  );
  for (const anchor of disabledAnchors) {
    anchor.removeAttribute('data-wiki-game-disabled');
    anchor.removeAttribute('aria-disabled');
    anchor.removeAttribute('tabindex');
  }
}

export default defineContentScript({
  matches: ['*://*.wikipedia.org/*'],
  runAt: 'document_end',

  main() {
    let isMatchActive = false;
    let activeLang: Language = 'pt';
    let domObserver: MutationObserver | null = null;

    function handleLinkClick(event: MouseEvent): void {
      if (!isMatchActive) return;

      const target = (event.target as Element | null)?.closest?.('a');
      if (!target) return;

      const rawHref = target.getAttribute('href');
      if (!rawHref) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (
        target.getAttribute('data-wiki-game-disabled') === 'true' ||
        !isAllowedWikiLinkHref(rawHref, window.location.href, activeLang)
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    function handleAuxClick(event: MouseEvent): void {
      if (!isMatchActive) return;
      const target = (event.target as Element | null)?.closest?.('a');
      if (target) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    document.addEventListener('click', handleLinkClick, true);
    document.addEventListener('auxclick', handleAuxClick, true);

    function applyStateToDom(state: ActiveMatchState): void {
      const playing = state.status === 'playing' && state.match !== null;
      isMatchActive = playing;

      if (!playing || !state.match) {
        removeDomLockStyle();
        restorePageLinks();
        if (domObserver) {
          domObserver.disconnect();
          domObserver = null;
        }
        return;
      }

      activeLang = state.match.lang;
      applyDomLockStyle();
      sanitizePageLinks(activeLang);

      if (!domObserver && document.body) {
        domObserver = new MutationObserver(() => {
          if (isMatchActive) {
            sanitizePageLinks(activeLang);
          }
        });
        domObserver.observe(document.body, { childList: true, subtree: true });
      }
    }

    function reportCurrentArticleToServiceWorker(): void {
      const canonicalTitle = extractCanonicalTitle();
      if (!canonicalTitle) return;

      chrome.runtime.sendMessage(
        {
          type: 'ARTICLE_VISITED',
          payload: {
            canonicalTitle,
            url: window.location.href,
            isDisambiguation: detectDisambiguationPage(),
          },
        } satisfies ExtensionMessage,
        (response: { ok?: boolean; state?: ActiveMatchState } | undefined) => {
          if (chrome.runtime.lastError) return;
          if (response?.state) {
            applyStateToDom(response.state);
          }
        }
      );
    }

    // Reporta imediatamente a página carregada ao Service Worker e sincroniza o DOM
    reportCurrentArticleToServiceWorker();

    // Escuta notificações diretas do Service Worker (ex: início ou fim de partida)
    chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
      if (message.type === 'STATE_UPDATED') {
        applyStateToDom(message.payload);
      }
    });

    // Escuta mudanças no chrome.storage.session quando disponível no contexto
    if (chrome.storage?.session?.onChanged) {
      chrome.storage.session.onChanged.addListener((changes) => {
        if (changes[SESSION_STORAGE_KEY]?.newValue) {
          applyStateToDom(changes[SESSION_STORAGE_KEY].newValue as ActiveMatchState);
        }
      });
    }
  },
});
