import { defineBackground } from 'wxt/sandbox';
import type {
  ActiveMatchState,
  ExtensionMessage,
  LossReason,
  MatchInfo,
  ScoreResult,
} from '../src/types.js';
import {
  createInitialMatchState,
  getMatchState,
  normalizeApiUrl,
  setMatchState,
} from '../src/utils/storage.js';
import {
  extractTitleFromWikiUrl,
  isWikipediaHostname,
  normalizeArticleTitle,
} from '../src/utils/wiki.js';

function notifyTabState(tabId: number | null, state: ActiveMatchState): void {
  if (tabId === null) return;
  chrome.tabs
    .sendMessage(tabId, {
      type: 'STATE_UPDATED',
      payload: state,
    } satisfies ExtensionMessage)
    .catch(() => {});
}

async function triggerAutomaticDefeat(
  state: ActiveMatchState,
  reason: LossReason,
  details: string
): Promise<ActiveMatchState> {
  if (state.status !== 'playing') {
    return state;
  }

  const nextState: ActiveMatchState = {
    ...state,
    status: 'lost',
    lossReason: reason,
    lossDetails: details,
    initialNavigationPending: false,
  };

  await setMatchState(nextState);
  notifyTabState(nextState.tabId, nextState);
  return nextState;
}

async function handleStartMatch(
  payload: Extract<ExtensionMessage, { type: 'START_MATCH' }>['payload']
): Promise<ActiveMatchState> {
  const apiUrl = normalizeApiUrl(payload.apiUrl);

  const res = await fetch(`${apiUrl}/game/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: payload.mode,
      lang: payload.lang,
      difficulty: payload.difficulty,
      limits: payload.limits,
      enableModifiers: payload.enableModifiers,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Falha ao iniciar partida na API (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as { token: string; match: MatchInfo };
  const originSlug = encodeURIComponent(data.match.origin.replace(/ /g, '_'));
  const startUrl = `https://${data.match.lang}.wikipedia.org/wiki/${originSlug}`;

  const allTabs = await chrome.tabs.query({});
  const wikiTabs = allTabs.filter((t) => {
    if (!t.url) return false;
    try {
      return isWikipediaHostname(new URL(t.url).hostname);
    } catch {
      return false;
    }
  });

  let gameTabId: number;
  let shouldNavigateExistingTab = false;

  if (wikiTabs.length > 0 && wikiTabs[0].id !== undefined) {
    gameTabId = wikiTabs[0].id;
    shouldNavigateExistingTab = true;
    const extraTabIds = wikiTabs
      .slice(1)
      .map((t) => t.id)
      .filter((id): id is number => id !== undefined);
    if (extraTabIds.length > 0) {
      await chrome.tabs.remove(extraTabIds);
    }
  } else {
    const createdTab = await chrome.tabs.create({ url: startUrl, active: true });
    if (createdTab.id === undefined) {
      throw new Error('Não foi possível criar a aba da partida.');
    }
    gameTabId = createdTab.id;
  }

  const newState: ActiveMatchState = {
    status: 'playing',
    apiUrl,
    token: data.token,
    tabId: gameTabId,
    match: data.match,
    path: [
      {
        title: normalizeArticleTitle(data.match.origin),
        timestamp: data.match.startedAt,
      },
    ],
    initialNavigationPending: true,
  };

  await setMatchState(newState);

  if (shouldNavigateExistingTab) {
    await chrome.tabs.update(gameTabId, { url: startUrl, active: true });
  }

  notifyTabState(gameTabId, newState);
  return newState;
}

async function handleArticleVisited(
  senderTabId: number | undefined,
  canonicalTitle: string
): Promise<ActiveMatchState> {
  const state = await getMatchState();

  if (state.status !== 'playing' || !state.match || !state.token) {
    return state;
  }

  if (senderTabId === undefined || senderTabId !== state.tabId) {
    return state;
  }

  const normalizedVisited = normalizeArticleTitle(canonicalTitle);
  if (!normalizedVisited) {
    return state;
  }

  const lastStep = state.path[state.path.length - 1];

  // Se é o mesmo artigo que o último passo registrado (carregamento inicial da origem ou âncora #seção)
  if (lastStep && lastStep.title.toLowerCase() === normalizedVisited.toLowerCase()) {
    if (state.initialNavigationPending) {
      const cleared: ActiveMatchState = { ...state, initialNavigationPending: false };
      await setMatchState(cleared);
      return cleared;
    }
    return state;
  }

  const now = Date.now();
  const updatedPath = [...state.path, { title: normalizedVisited, timestamp: now }];
  const clicks = updatedPath.length - 1;
  const elapsedSeconds = Math.floor((now - state.match.startedAt) / 1000);

  // Verifica limite customizável de tempo
  if (
    state.match.limits.maxTimeSeconds !== null &&
    elapsedSeconds > state.match.limits.maxTimeSeconds
  ) {
    return triggerAutomaticDefeat(
      { ...state, path: updatedPath },
      'max_time_exceeded',
      `Tempo limite de ${state.match.limits.maxTimeSeconds}s excedido (${elapsedSeconds}s).`
    );
  }

  // Verifica limite customizável de cliques
  if (state.match.limits.maxClicks !== null && clicks > state.match.limits.maxClicks) {
    return triggerAutomaticDefeat(
      { ...state, path: updatedPath },
      'max_clicks_exceeded',
      `Limite de ${state.match.limits.maxClicks} cliques excedido (${clicks} cliques).`
    );
  }

  const normalizedTarget = normalizeArticleTitle(state.match.target);

  // Se atingiu o artigo objetivo, finaliza e valida na API Stateless
  if (normalizedVisited.toLowerCase() === normalizedTarget.toLowerCase()) {
    const validatingState: ActiveMatchState = {
      ...state,
      status: 'validating',
      path: updatedPath,
      initialNavigationPending: false,
    };
    await setMatchState(validatingState);
    notifyTabState(state.tabId, validatingState);

    try {
      const finishRes = await fetch(`${state.apiUrl}/game/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: state.token,
          path: updatedPath,
        }),
      });

      const finishData = (await finishRes.json()) as {
        valid?: boolean;
        reason?: string;
        score?: ScoreResult;
        error?: string;
      };

      if (!finishRes.ok || !finishData.valid || !finishData.score) {
        const failedState: ActiveMatchState = {
          ...validatingState,
          status: 'lost',
          lossReason: 'validation_failed',
          lossDetails:
            finishData.reason ??
            finishData.error ??
            `A API rejeitou a validação do caminho (status ${finishRes.status}).`,
        };
        await setMatchState(failedState);
        notifyTabState(state.tabId, failedState);
        return failedState;
      }

      const wonState: ActiveMatchState = {
        ...validatingState,
        status: 'won',
        score: finishData.score,
      };
      await setMatchState(wonState);
      notifyTabState(state.tabId, wonState);
      return wonState;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro de rede ao validar partida.';
      const failedState: ActiveMatchState = {
        ...validatingState,
        status: 'lost',
        lossReason: 'validation_failed',
        lossDetails: errorMessage,
      };
      await setMatchState(failedState);
      notifyTabState(state.tabId, failedState);
      return failedState;
    }
  }

  const playingState: ActiveMatchState = {
    ...state,
    path: updatedPath,
    initialNavigationPending: false,
  };
  await setMatchState(playingState);
  notifyTabState(state.tabId, playingState);
  return playingState;
}

export default defineBackground(() => {
  // Libera acesso ao chrome.storage.session para o Content Script
  if (chrome.storage?.session?.setAccessLevel) {
    chrome.storage.session
      .setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
      .catch(() => {});
  }

  // Abre o Side Panel nativo ao clicar no ícone da extensão
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }

  let actionQueue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = actionQueue.then(task, task);
    actionQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    if (message.type === 'STATE_UPDATED') {
      return false;
    }

    enqueue(async () => {
      if (message.type === 'START_MATCH') {
        const state = await handleStartMatch(message.payload);
        sendResponse({ ok: true, state });
      } else if (message.type === 'ARTICLE_VISITED') {
        const state = await handleArticleVisited(
          sender.tab?.id,
          message.payload.canonicalTitle
        );
        sendResponse({ ok: true, state });
      } else if (message.type === 'GET_MATCH_STATE') {
        const state = await getMatchState();
        sendResponse({ ok: true, state });
      } else if (message.type === 'SURRENDER_MATCH') {
        const current = await getMatchState();
        const next = await triggerAutomaticDefeat(
          current,
          'surrender',
          'Você desistiu da partida.'
        );
        sendResponse({ ok: true, state: next });
      } else if (message.type === 'RESET_MATCH') {
        const current = await getMatchState();
        const oldTabId = current.tabId;
        const reset = createInitialMatchState(current.apiUrl);
        await setMatchState(reset);
        notifyTabState(oldTabId, reset);
        sendResponse({ ok: true, state: reset });
      }
    }).catch((err: unknown) => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendResponse({ ok: false, error: errorMsg });
    });

    return true;
  });

  // Monitoramento de infrações via chrome.webNavigation.onCommitted
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return;

    enqueue(async () => {
      const state = await getMatchState();
      if (state.status !== 'playing' || !state.match) return;

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(details.url);
      } catch {
        return;
      }

      // 1. Verifica abertura/navegação em OUTRA aba da Wikipédia durante a partida
      if (details.tabId !== state.tabId) {
        if (isWikipediaHostname(parsedUrl.hostname)) {
          await triggerAutomaticDefeat(
            state,
            'multiple_wiki_tabs',
            'Derrota automática: outra aba da Wikipédia foi aberta ou utilizada durante a partida.'
          );
        }
        return;
      }

      // Se é o commit do carregamento inicial aberto pela extensão, limpa a flag pendente
      if (state.initialNavigationPending) {
        await setMatchState({ ...state, initialNavigationPending: false });
        return;
      }

      // 2. Verifica uso dos botões Voltar ou Avançar do navegador (forward_back)
      if (details.transitionQualifiers.includes('forward_back')) {
        await triggerAutomaticDefeat(
          state,
          'forward_back',
          'Derrota automática: o uso dos botões Voltar ou Avançar do navegador é proibido.'
        );
        return;
      }

      // 3. Verifica digitação manual de URL na barra de endereços (from_address_bar / typed)
      if (
        details.transitionQualifiers.includes('from_address_bar') ||
        details.transitionType === 'typed' ||
        details.transitionType === 'generated'
      ) {
        await triggerAutomaticDefeat(
          state,
          'typed_url',
          'Derrota automática: digitar uma URL manualmente na barra de endereços é proibido.'
        );
        return;
      }
    }).catch(() => {});
  });

  // Fallback: ao concluir carregamento no frame principal da aba da partida, garante que a visita foi registrada
  chrome.webNavigation.onCompleted.addListener((details) => {
    if (details.frameId !== 0) return;

    enqueue(async () => {
      const state = await getMatchState();
      if (state.status !== 'playing' || !state.match || details.tabId !== state.tabId) {
        return;
      }

      const fallbackTitle = extractTitleFromWikiUrl(details.url, state.match.lang);
      if (fallbackTitle) {
        await handleArticleVisited(details.tabId, fallbackTitle);
      }
    }).catch(() => {});
  });

  chrome.webNavigation.onReferenceFragmentUpdated.addListener(() => {
    // Mudanças apenas de #hash são permitidas e não contam como clique nem infração
  });
});
