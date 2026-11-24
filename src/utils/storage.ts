import type { ActiveMatchState, ExtensionMessage } from '../types.js';

export const SESSION_STORAGE_KEY = 'wiki_game_active_match';
export const DEFAULT_API_URL = 'https://wikipedia-game-api.pablosme9.workers.dev';

/**
 * Normaliza a URL da API garantindo a presença do protocolo (`https://` ou `http://`)
 * e removendo barras extras no final.
 */
export function normalizeApiUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return DEFAULT_API_URL;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith('localhost') || trimmed.startsWith('127.0.0.1')) {
    return `http://${trimmed}`;
  }

  return `https://${trimmed}`;
}

export function createInitialMatchState(apiUrl: string = DEFAULT_API_URL): ActiveMatchState {
  return {
    status: 'idle',
    apiUrl: normalizeApiUrl(apiUrl),
    token: null,
    tabId: null,
    match: null,
    path: [],
    initialNavigationPending: false,
  };
}

export async function getMatchState(): Promise<ActiveMatchState> {
  const data = await chrome.storage.session.get(SESSION_STORAGE_KEY);
  const stored = data[SESSION_STORAGE_KEY] as ActiveMatchState | undefined;
  if (!stored) {
    return createInitialMatchState();
  }
  return {
    ...stored,
    apiUrl: normalizeApiUrl(stored.apiUrl || DEFAULT_API_URL),
  };
}

export async function setMatchState(state: ActiveMatchState): Promise<void> {
  const normalizedState: ActiveMatchState = {
    ...state,
    apiUrl: normalizeApiUrl(state.apiUrl || DEFAULT_API_URL),
  };

  await chrome.storage.session.set({
    [SESSION_STORAGE_KEY]: normalizedState,
  });

  // Notifica contextos ativos da extensão (como o Side Panel) sobre a mudança de estado
  chrome.runtime
    .sendMessage({
      type: 'STATE_UPDATED',
      payload: normalizedState,
    } satisfies ExtensionMessage)
    .catch(() => {});
}

export async function updateMatchState(
  updater: (current: ActiveMatchState) => ActiveMatchState
): Promise<ActiveMatchState> {
  const current = await getMatchState();
  const next = updater(current);
  await setMatchState(next);
  return next;
}
