import type {
  ActiveMatchState,
  Difficulty,
  ExtensionMessage,
  GameMode,
  Language,
  LossReason,
  MatchInfo,
} from '../../src/types.js';
import {
  createInitialMatchState,
  DEFAULT_API_URL,
  getMatchState,
  SESSION_STORAGE_KEY,
} from '../../src/utils/storage.js';

const appRoot = document.getElementById('app') as HTMLElement;

let currentState: ActiveMatchState = createInitialMatchState();
let timerInterval: number | null = null;
let uiErrorMessage: string | null = null;

// Cache em memória dos resumos de artigos para a tooltip (chave: "lang:title")
const articleSummaryCache = new Map<string, string>();
const pendingSummaryFetches = new Set<string>();

// Preferências locais do menu inicial
let selectedMode: GameMode = 'free';
let selectedLang: Language = 'pt';
let selectedDifficulty: Difficulty = 'medium';
let timeLimitEnabled = false;
let customTimeLimitSec = 300;
let clickLimitEnabled = false;
let customClickLimit = 20;
let enableModifiers = true;
let customApiUrl = DEFAULT_API_URL;

const TOPIC_LABELS: Record<string, string> = {
  'STEM.Physics': 'Física (STEM.Physics)',
  'STEM.Computing': 'Computação (STEM.Computing)',
  'STEM.Space': 'Espaço & Astronomia (STEM.Space)',
  'Culture.Sports': 'Esportes (Culture.Sports)',
  'Culture.Literature': 'Literatura (Culture.Literature)',
  'History_and_Society.History': 'História (History_and_Society.History)',
  'History_and_Society.Politics_and_government': 'Política & Governo (Politics)',
  'Geography.Regions': 'Geografia & Regiões (Geography.Regions)',
};

function formatTopicName(topic: string): string {
  return TOPIC_LABELS[topic] ?? topic;
}

function formatBreakdownLabel(rawLabel: string): string {
  if (rawLabel === 'clicks') return 'Cliques realizados';
  if (rawLabel === 'time_seconds') return 'Tempo decorrido (s)';
  if (rawLabel.startsWith('topic:')) {
    const topic = rawLabel.slice('topic:'.length);
    return `Tópico: ${formatTopicName(topic)}`;
  }
  if (rawLabel.startsWith('checkpoint:')) {
    return `Checkpoint alcançado (${rawLabel.slice('checkpoint:'.length)})`;
  }
  if (rawLabel.startsWith('checkpoint_missed:')) {
    return `Checkpoint obrigatório perdido (${rawLabel.slice('checkpoint_missed:'.length)})`;
  }
  if (rawLabel.startsWith('checkpoint_optional:')) {
    return `Checkpoint opcional (${rawLabel.slice('checkpoint_optional:'.length)})`;
  }
  return rawLabel;
}

function getClickPenaltyTierLabel(penalty: number): string {
  if (penalty <= 5) return 'Peso Leve';
  if (penalty >= 20) return 'Peso Dobrado';
  return 'Peso Padrão';
}

function getTimePenaltyTierLabel(penalty: number): string {
  if (penalty <= 1) return 'Ritmo Leve';
  if (penalty >= 4) return 'Ritmo Acelerado';
  return 'Ritmo Padrão';
}

function sendMessageToBackground(
  message: ExtensionMessage
): Promise<{ ok: boolean; state?: ActiveMatchState; error?: string }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response ?? { ok: false, error: 'Sem resposta do Service Worker' });
    });
  });
}

function formatSeconds(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatLossReason(reason?: LossReason): string {
  switch (reason) {
    case 'forward_back':
      return 'Infração: uso dos botões Voltar/Avançar';
    case 'typed_url':
      return 'Infração: URL digitada manualmente';
    case 'multiple_wiki_tabs':
      return 'Infração: abertura de outra aba da Wikipédia';
    case 'max_clicks_exceeded':
      return 'Limite máximo de cliques excedido';
    case 'max_time_exceeded':
      return 'Limite máximo de tempo excedido';
    case 'surrender':
      return 'Partida encerrada por desistência';
    case 'validation_failed':
      return 'Falha na validação do caminho na API';
    default:
      return 'Partida encerrada';
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function shouldShowSummaryTooltip(difficulty: Difficulty): boolean {
  return difficulty === 'easy' || difficulty === 'medium';
}

async function fetchArticleSummary(lang: Language, title: string): Promise<string> {
  const cacheKey = `${lang}:${title}`;
  const cached = articleSummaryCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const slug = encodeURIComponent(title.replace(/ /g, '_'));
    const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${slug}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as { extract?: string; description?: string };
    const summaryText =
      data.extract?.trim() ||
      data.description?.trim() ||
      'Resumo não disponível para este artigo.';
    articleSummaryCache.set(cacheKey, summaryText);
    return summaryText;
  } catch {
    return 'Não foi possível carregar o resumo deste artigo.';
  }
}

function prefetchArticleSummary(lang: Language, title: string): void {
  const cacheKey = `${lang}:${title}`;
  if (articleSummaryCache.has(cacheKey) || pendingSummaryFetches.has(cacheKey)) {
    return;
  }
  pendingSummaryFetches.add(cacheKey);
  fetchArticleSummary(lang, title).finally(() => {
    pendingSummaryFetches.delete(cacheKey);
  });
}

function buildSummaryAttrs(match: MatchInfo, title: string): string {
  if (!shouldShowSummaryTooltip(match.difficulty)) {
    return '';
  }
  return `data-wiki-summary-title="${escapeHtml(title)}" data-wiki-summary-lang="${escapeHtml(match.lang)}"`;
}

function renderRouteCardWithTooltips(match: MatchInfo): string {
  const showTooltip = shouldShowSummaryTooltip(match.difficulty);

  return `
    <div class="card route-box">
      <div class="route-point" ${buildSummaryAttrs(match, match.origin)}>
        <div class="route-point-header">
          <div class="label">Artigo Inicial</div>
          ${showTooltip ? '<span class="tooltip-hint">ℹ️ Resumo</span>' : ''}
        </div>
        <div class="value">${escapeHtml(match.origin)}</div>
      </div>

      <div class="route-point" ${buildSummaryAttrs(match, match.target)}>
        <div class="route-point-header">
          <div class="label">Artigo Objetivo</div>
          ${showTooltip ? '<span class="tooltip-hint">ℹ️ Resumo</span>' : ''}
        </div>
        <div class="value">${escapeHtml(match.target)}</div>
      </div>
    </div>
  `;
}

function renderRoundModifiersCard(match: MatchInfo, pathTitles: string[]): string {
  const { modifiers } = match;
  const checkpoint = modifiers.checkpoint;
  const visitedAfterOrigin = pathTitles.slice(1).map((t) => t.toLowerCase());
  const checkpointVisited = checkpoint
    ? visitedAfterOrigin.includes(checkpoint.title.toLowerCase())
    : false;

  const clickTier = getClickPenaltyTierLabel(modifiers.clickPenalty);
  const timeTier = getTimePenaltyTierLabel(modifiers.timePenalty);

  const topicsHtml =
    modifiers.topicModifiers.length > 0
      ? modifiers.topicModifiers
          .map((tm) => {
            const isBonus = tm.points >= 0;
            return `
              <div class="modifier-item ${isBonus ? 'bonus' : 'penalty'}">
                <div class="modifier-info">
                  <span class="modifier-title">${isBonus ? '🎯 Bônus de Tópico' : '⚠️ Penalidade de Tópico'}</span>
                  <span class="modifier-desc">${escapeHtml(formatTopicName(tm.topic))}</span>
                </div>
                <span class="modifier-value ${isBonus ? 'positive' : 'negative'}">
                  ${isBonus ? `+${tm.points}` : tm.points} pts/artigo
                </span>
              </div>
            `;
          })
          .join('')
      : `
        <div class="modifier-item neutral">
          <div class="modifier-info">
            <span class="modifier-title">🎯 Modificador de Tópico</span>
            <span class="modifier-desc">Desativado nesta partida</span>
          </div>
          <span class="modifier-value neutral">0 pts</span>
        </div>
      `;

  let checkpointHtml = `
    <div class="modifier-item neutral">
      <div class="modifier-info">
        <span class="modifier-title">🏁 Checkpoint Intermediário</span>
        <span class="modifier-desc">Sem parada intermediária sorteada</span>
      </div>
      <span class="modifier-value neutral">—</span>
    </div>
  `;

  if (checkpoint) {
    const statusText = checkpointVisited
      ? '✅ Alcançado!'
      : checkpoint.required
        ? '❗ Obrigatório (Pendente)'
        : '⏳ Opcional (Pendente)';

    const itemClass = checkpointVisited
      ? 'bonus'
      : checkpoint.required
        ? 'warning'
        : 'neutral';

    const valueClass = checkpointVisited
      ? 'positive'
      : checkpoint.required
        ? 'negative'
        : 'neutral';

    checkpointHtml = `
      <div class="modifier-item ${itemClass}" ${buildSummaryAttrs(match, checkpoint.title)}>
        <div class="modifier-info">
          <span class="modifier-title">🏁 Checkpoint: ${escapeHtml(checkpoint.title)} ${shouldShowSummaryTooltip(match.difficulty) ? 'ℹ️' : ''}</span>
          <span class="modifier-desc">${statusText}</span>
        </div>
        <span class="modifier-value ${valueClass}">
          ${checkpoint.required ? `+${checkpoint.points} / -${checkpoint.points}` : `+${checkpoint.points}`} pts
        </span>
      </div>
    `;
  }

  return `
    <div class="card">
      <div class="card-title">Modificadores Ativos do Round</div>
      <div class="modifiers-list">
        <div class="modifier-item ${modifiers.clickPenalty > 10 ? 'penalty' : modifiers.clickPenalty < 10 ? 'bonus' : 'neutral'}">
          <div class="modifier-info">
            <span class="modifier-title">🖱️ Multiplicador de Cliques (${clickTier})</span>
            <span class="modifier-desc">Desconto linear por clique realizado</span>
          </div>
          <span class="modifier-value negative">-${modifiers.clickPenalty} pts/clique</span>
        </div>

        <div class="modifier-item ${modifiers.timePenalty > 2 ? 'penalty' : modifiers.timePenalty < 2 ? 'bonus' : 'neutral'}">
          <div class="modifier-info">
            <span class="modifier-title">⏱️ Multiplicador de Tempo (${timeTier})</span>
            <span class="modifier-desc">Desconto linear por segundo decorrido</span>
          </div>
          <span class="modifier-value negative">-${modifiers.timePenalty} pts/s</span>
        </div>

        ${topicsHtml}
        ${checkpointHtml}
      </div>
    </div>
  `;
}

function stopLiveTimer(): void {
  if (timerInterval !== null) {
    window.clearInterval(timerInterval);
    timerInterval = null;
  }
}

function startLiveTimer(): void {
  stopLiveTimer();
  timerInterval = window.setInterval(() => {
    if (currentState.status !== 'playing' || !currentState.match) {
      stopLiveTimer();
      return;
    }

    const timerEl = document.getElementById('live-timer-value');
    const timeDeductionEl = document.getElementById('live-time-deduction');
    const elapsedSec = Math.max(
      0,
      Math.floor((Date.now() - currentState.match.startedAt) / 1000)
    );

    if (timerEl) {
      const maxTime = currentState.match.limits.maxTimeSeconds;
      timerEl.textContent = maxTime
        ? `${formatSeconds(elapsedSec)} / ${formatSeconds(maxTime)}`
        : formatSeconds(elapsedSec);
    }

    if (timeDeductionEl) {
      const timeLoss = elapsedSec * currentState.match.modifiers.timePenalty;
      timeDeductionEl.textContent = `Tempo (-${timeLoss} pts acumulados)`;
    }
  }, 500);
}

function renderIdleView(): void {
  stopLiveTimer();
  const isDaily = selectedMode === 'daily';

  appRoot.innerHTML = `
    <div class="header">
      <h1>🌐 Wikipedia Game</h1>
      <span class="badge">V1 Stateless</span>
    </div>

    ${uiErrorMessage ? `<div class="error-msg">${escapeHtml(uiErrorMessage)}</div>` : ''}

    <div class="card">
      <div class="card-title">Configuração da Partida</div>

      <div class="form-group">
        <label for="select-mode">Modo de Jogo</label>
        <select id="select-mode">
          <option value="free" ${selectedMode === 'free' ? 'selected' : ''}>Jogo Livre</option>
          <option value="daily" ${selectedMode === 'daily' ? 'selected' : ''}>Desafio do Dia</option>
        </select>
      </div>

      <div class="form-group">
        <label for="select-lang">Idioma da Wikipédia</label>
        <select id="select-lang">
          <option value="pt" ${selectedLang === 'pt' ? 'selected' : ''}>Português (pt.wikipedia.org)</option>
          <option value="en" ${selectedLang === 'en' ? 'selected' : ''}>English (en.wikipedia.org)</option>
        </select>
      </div>

      ${
        !isDaily
          ? `
        <div class="form-group">
          <label for="select-difficulty">Dificuldade (Faixa de Conectividade)</label>
          <select id="select-difficulty">
            <option value="easy" ${selectedDifficulty === 'easy' ? 'selected' : ''}>Fácil (Alta conectividade / Tier 1)</option>
            <option value="medium" ${selectedDifficulty === 'medium' ? 'selected' : ''}>Médio (Média conectividade / Tier 2)</option>
            <option value="hard" ${selectedDifficulty === 'hard' ? 'selected' : ''}>Difícil (Menor conectividade / Tier 3)</option>
          </select>
        </div>
      `
          : ''
      }
    </div>

    <div class="card">
      <div class="card-title">Modificadores de Round (Base: 1.000 pts)</div>
      ${
        !isDaily
          ? `
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="check-modifiers" ${enableModifiers ? 'checked' : ''} />
            Sortear modificadores dinâmicos na partida
          </label>
        </div>
      `
          : ''
      }
      <div class="modifiers-list">
        <div class="modifier-item neutral">
          <div class="modifier-info">
            <span class="modifier-title">🖱️ Peso de Cliques</span>
            <span class="modifier-desc">${!isDaily && !enableModifiers ? 'Fixo no valor padrão' : 'Sorteia Leve (-5), Padrão (-10) ou Dobrado (-20)'}</span>
          </div>
          <span class="modifier-value negative">${!isDaily && !enableModifiers ? '-10 pts' : '-5 a -20'}</span>
        </div>

        <div class="modifier-item neutral">
          <div class="modifier-info">
            <span class="modifier-title">⏱️ Peso de Tempo</span>
            <span class="modifier-desc">${!isDaily && !enableModifiers ? 'Fixo no valor padrão' : 'Sorteia Leve (-1), Padrão (-2) ou Acelerado (-4)'}</span>
          </div>
          <span class="modifier-value negative">${!isDaily && !enableModifiers ? '-2 pts/s' : '-1 a -4/s'}</span>
        </div>

        <div class="modifier-item ${!isDaily && !enableModifiers ? 'neutral' : 'bonus'}">
          <div class="modifier-info">
            <span class="modifier-title">🎯 Tópico Lift Wing</span>
            <span class="modifier-desc">${!isDaily && !enableModifiers ? 'Desativado' : 'Bônus (+40) ou Penalidade (-25) por artigo do tema'}</span>
          </div>
          <span class="modifier-value ${!isDaily && !enableModifiers ? 'neutral' : 'positive'}">${!isDaily && !enableModifiers ? 'OFF' : '+40 / -25'}</span>
        </div>

        <div class="modifier-item ${!isDaily && !enableModifiers ? 'neutral' : 'warning'}">
          <div class="modifier-info">
            <span class="modifier-title">🏁 Checkpoint Intermediário</span>
            <span class="modifier-desc">${!isDaily && !enableModifiers ? 'Desativado' : 'Parada opcional (+100) ou obrigatória (±150)'}</span>
          </div>
          <span class="modifier-value ${!isDaily && !enableModifiers ? 'neutral' : 'positive'}">${!isDaily && !enableModifiers ? 'OFF' : '+100 / ±150'}</span>
        </div>
      </div>
    </div>

    ${
      !isDaily
        ? `
      <div class="card">
        <div class="card-title">Limites Customizáveis</div>

        <div class="form-group">
          <div class="form-row">
            <label class="checkbox-label">
              <input type="checkbox" id="check-time-limit" ${timeLimitEnabled ? 'checked' : ''} />
              Limite de Tempo (segundos)
            </label>
          </div>
          <input
            type="number"
            id="input-time-limit"
            min="30"
            max="3600"
            step="30"
            value="${customTimeLimitSec}"
            ${!timeLimitEnabled ? 'disabled' : ''}
          />
        </div>

        <div class="form-group">
          <div class="form-row">
            <label class="checkbox-label">
              <input type="checkbox" id="check-click-limit" ${clickLimitEnabled ? 'checked' : ''} />
              Limite de Cliques
            </label>
          </div>
          <input
            type="number"
            id="input-click-limit"
            min="1"
            max="200"
            step="1"
            value="${customClickLimit}"
            ${!clickLimitEnabled ? 'disabled' : ''}
          />
        </div>
      </div>
    `
        : ''
    }

    <div class="card">
      <div class="card-title">Servidor da API</div>
      <div class="form-group">
        <input type="text" id="input-api-url" value="${escapeHtml(customApiUrl)}" />
      </div>
    </div>

    <button id="btn-start" class="btn btn-primary">Iniciar Partida</button>
  `;

  document.getElementById('select-mode')?.addEventListener('change', (e) => {
    selectedMode = (e.target as HTMLSelectElement).value as GameMode;
    renderIdleView();
  });

  document.getElementById('select-lang')?.addEventListener('change', (e) => {
    selectedLang = (e.target as HTMLSelectElement).value as Language;
  });

  document.getElementById('select-difficulty')?.addEventListener('change', (e) => {
    selectedDifficulty = (e.target as HTMLSelectElement).value as Difficulty;
  });

  document.getElementById('check-modifiers')?.addEventListener('change', (e) => {
    enableModifiers = (e.target as HTMLInputElement).checked;
    renderIdleView();
  });

  document.getElementById('check-time-limit')?.addEventListener('change', (e) => {
    timeLimitEnabled = (e.target as HTMLInputElement).checked;
    renderIdleView();
  });

  document.getElementById('input-time-limit')?.addEventListener('input', (e) => {
    customTimeLimitSec = Math.max(10, Number((e.target as HTMLInputElement).value) || 300);
  });

  document.getElementById('check-click-limit')?.addEventListener('change', (e) => {
    clickLimitEnabled = (e.target as HTMLInputElement).checked;
    renderIdleView();
  });

  document.getElementById('input-click-limit')?.addEventListener('input', (e) => {
    customClickLimit = Math.max(1, Number((e.target as HTMLInputElement).value) || 20);
  });

  document.getElementById('input-api-url')?.addEventListener('input', (e) => {
    customApiUrl = (e.target as HTMLInputElement).value.trim() || DEFAULT_API_URL;
  });

  document.getElementById('btn-start')?.addEventListener('click', async () => {
    uiErrorMessage = null;
    const apiInputEl = document.getElementById('input-api-url') as HTMLInputElement | null;
    if (apiInputEl && apiInputEl.value.trim()) {
      customApiUrl = apiInputEl.value.trim().replace(/\/+$/, '');
    }

    const btn = document.getElementById('btn-start') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Sorteando partida...';
    }

    const res = await sendMessageToBackground({
      type: 'START_MATCH',
      payload: {
        apiUrl: customApiUrl,
        mode: selectedMode,
        lang: selectedLang,
        difficulty: selectedDifficulty,
        enableModifiers,
        limits: {
          maxTimeSeconds: timeLimitEnabled ? customTimeLimitSec : null,
          maxClicks: clickLimitEnabled ? customClickLimit : null,
        },
      },
    });

    if (!res.ok) {
      uiErrorMessage = `${res.error ?? 'Erro ao conectar com a API Stateless.'} (URL: ${customApiUrl})`;
      renderIdleView();
    } else if (res.state) {
      renderApp(res.state);
    }
  });
}

function renderPlayingView(state: ActiveMatchState): void {
  const match = state.match!;
  const clicks = Math.max(0, state.path.length - 1);
  const elapsedSec = Math.max(0, Math.floor((Date.now() - match.startedAt) / 1000));
  const maxTime = match.limits.maxTimeSeconds;
  const maxClicks = match.limits.maxClicks;

  const clickLoss = clicks * match.modifiers.clickPenalty;
  const timeLoss = elapsedSec * match.modifiers.timePenalty;

  appRoot.innerHTML = `
    <div class="header">
      <h1>🌐 Em Partida (${escapeHtml(match.lang.toUpperCase())})</h1>
      <span class="badge ${state.status === 'validating' ? 'warning' : 'success'}">
        ${state.status === 'validating' ? 'Validando...' : match.mode === 'daily' ? 'Desafio do Dia' : 'Jogo Livre'}
      </span>
    </div>

    ${renderRouteCardWithTooltips(match)}

    <div class="stats-grid">
      <div class="stat-box">
        <div id="live-timer-value" class="stat-value">
          ${maxTime ? `${formatSeconds(elapsedSec)} / ${formatSeconds(maxTime)}` : formatSeconds(elapsedSec)}
        </div>
        <div id="live-time-deduction" class="stat-label">Tempo (-${timeLoss} pts acumulados)</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">
          ${maxClicks !== null ? `${clicks} / ${maxClicks}` : clicks}
        </div>
        <div class="stat-label">Cliques (-${clickLoss} pts acumulados)</div>
      </div>
    </div>

    ${renderRoundModifiersCard(
      match,
      state.path.map((p) => p.title)
    )}

    <div class="card">
      <div class="card-title">Caminho Percorrido (${state.path.length})</div>
      <ul class="path-list">
        ${state.path
          .map(
            (step, idx) => `
          <li class="path-item" ${buildSummaryAttrs(match, step.title)}>
            <span class="path-index">${idx}</span>
            <span style="flex: 1;">${escapeHtml(step.title)}</span>
            ${shouldShowSummaryTooltip(match.difficulty) ? '<span class="tooltip-hint">ℹ️</span>' : ''}
          </li>
        `
          )
          .join('')}
      </ul>
    </div>

    <button id="btn-surrender" class="btn btn-danger" ${state.status === 'validating' ? 'disabled' : ''}>
      Desistir da Partida
    </button>
  `;

  document.getElementById('btn-surrender')?.addEventListener('click', async () => {
    await sendMessageToBackground({ type: 'SURRENDER_MATCH' });
  });

  if (shouldShowSummaryTooltip(match.difficulty)) {
    prefetchArticleSummary(match.lang, match.origin);
    prefetchArticleSummary(match.lang, match.target);
    if (match.modifiers.checkpoint) {
      prefetchArticleSummary(match.lang, match.modifiers.checkpoint.title);
    }
    for (const step of state.path) {
      prefetchArticleSummary(match.lang, step.title);
    }
  }

  if (state.status === 'playing') {
    startLiveTimer();
  } else {
    stopLiveTimer();
  }
}

function renderSummaryView(state: ActiveMatchState): void {
  stopLiveTimer();
  const isWon = state.status === 'won' && state.score;
  const match = state.match;

  appRoot.innerHTML = `
    <div class="header">
      <h1>${isWon ? '🏆 Vitória Validada!' : '❌ Fim de Jogo'}</h1>
      <span class="badge ${isWon ? 'success' : 'danger'}">${isWon ? 'Vitória' : 'Derrota'}</span>
    </div>

    ${
      isWon && state.score
        ? `
      <div class="card">
        <div class="card-title">Pontuação Final</div>
        <div class="score-big">${state.score.finalScore} pts</div>
        <table class="breakdown-table">
          <thead>
            <tr>
              <th>Modificador / Item</th>
              <th>Qtd × Peso</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Pontuação Base</td>
              <td>1 × +${state.score.baseScore}</td>
              <td>+${state.score.baseScore}</td>
            </tr>
            ${state.score.breakdown
              .map(
                (item) => `
              <tr>
                <td>${escapeHtml(formatBreakdownLabel(item.label))}</td>
                <td>${item.count} × (${item.multiplier >= 0 ? `+${item.multiplier}` : item.multiplier})</td>
                <td>${item.delta >= 0 ? `+${item.delta}` : item.delta}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `
        : `
      <div class="card">
        <div class="card-title">Motivo da Derrota</div>
        <div style="font-weight: 700; color: #f87171;">${escapeHtml(formatLossReason(state.lossReason))}</div>
        ${state.lossDetails ? `<div style="font-size: 12px; color: var(--text-muted);">${escapeHtml(state.lossDetails)}</div>` : ''}
      </div>
    `
    }

    ${
      match
        ? renderRouteCardWithTooltips(match)
        : ''
    }

    ${
      match
        ? renderRoundModifiersCard(
            match,
            state.path.map((p) => p.title)
          )
        : ''
    }

    ${
      match
        ? `
      <div class="card">
        <div class="card-title">Caminho (${escapeHtml(match.origin)} → ${escapeHtml(match.target)})</div>
        <ul class="path-list">
          ${state.path
            .map(
              (step, idx) => `
            <li class="path-item" ${buildSummaryAttrs(match, step.title)}>
              <span class="path-index">${idx}</span>
              <span style="flex: 1;">${escapeHtml(step.title)}</span>
              ${shouldShowSummaryTooltip(match.difficulty) ? '<span class="tooltip-hint">ℹ️</span>' : ''}
            </li>
          `
            )
            .join('')}
        </ul>
      </div>
    `
        : ''
    }

    ${
      isWon
        ? `<button id="btn-copy-share" class="btn btn-secondary">Copiar Resumo Compartilhável</button>`
        : ''
    }
    <button id="btn-reset" class="btn btn-primary">Nova Partida</button>
  `;

  document.getElementById('btn-copy-share')?.addEventListener('click', async () => {
    if (!match || !state.score) return;
    const summaryText = [
      `🌐 Wikipedia Game (${match.lang.toUpperCase()} • ${match.mode === 'daily' ? 'Desafio do Dia' : 'Jogo Livre'})`,
      `🎯 ${match.origin} ➡️ ${match.target}`,
      `🏆 Pontuação: ${state.score.finalScore} pts`,
      `🖱️ Cliques: ${state.score.clicks} (-${match.modifiers.clickPenalty}/clique) | ⏱️ Tempo: ${state.score.elapsedSeconds}s (-${match.modifiers.timePenalty}/s)`,
    ].join('\n');

    await navigator.clipboard.writeText(summaryText);
    const btn = document.getElementById('btn-copy-share');
    if (btn) btn.textContent = '✅ Resumo Copiado!';
  });

  document.getElementById('btn-reset')?.addEventListener('click', async () => {
    await sendMessageToBackground({ type: 'RESET_MATCH' });
  });

  if (match && shouldShowSummaryTooltip(match.difficulty)) {
    prefetchArticleSummary(match.lang, match.origin);
    prefetchArticleSummary(match.lang, match.target);
    if (match.modifiers.checkpoint) {
      prefetchArticleSummary(match.lang, match.modifiers.checkpoint.title);
    }
    for (const step of state.path) {
      prefetchArticleSummary(match.lang, step.title);
    }
  }
}

function renderApp(state: ActiveMatchState): void {
  currentState = state;
  customApiUrl = state.apiUrl || DEFAULT_API_URL;
  hideFloatingTooltip();

  if (state.status === 'idle' || !state.match) {
    renderIdleView();
  } else if (state.status === 'playing' || state.status === 'validating') {
    renderPlayingView(state);
  } else {
    renderSummaryView(state);
  }
}

const floatingTooltipEl = document.createElement('div');
floatingTooltipEl.className = 'wiki-floating-tooltip hidden';
floatingTooltipEl.setAttribute('role', 'tooltip');
document.body.appendChild(floatingTooltipEl);

let activeTooltipTarget: Element | null = null;

function hideFloatingTooltip(): void {
  activeTooltipTarget = null;
  floatingTooltipEl.classList.add('hidden');
}

function positionFloatingTooltip(targetEl: Element): void {
  const rect = targetEl.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const spaceBelow = viewportHeight - rect.bottom;

  if (spaceBelow >= 170 || rect.top < 170) {
    floatingTooltipEl.style.top = `${Math.min(viewportHeight - 40, rect.bottom + 6)}px`;
    floatingTooltipEl.style.bottom = 'auto';
  } else {
    floatingTooltipEl.style.bottom = `${Math.max(8, viewportHeight - rect.top + 6)}px`;
    floatingTooltipEl.style.top = 'auto';
  }
}

document.addEventListener('mouseover', (event) => {
  const target = (event.target as Element | null)?.closest?.('[data-wiki-summary-title]');
  if (!target) {
    if (activeTooltipTarget) {
      hideFloatingTooltip();
    }
    return;
  }

  if (target === activeTooltipTarget) {
    return;
  }

  activeTooltipTarget = target;
  const title = target.getAttribute('data-wiki-summary-title');
  const lang = (target.getAttribute('data-wiki-summary-lang') as Language | null) ?? 'pt';

  if (!title) {
    hideFloatingTooltip();
    return;
  }

  const cacheKey = `${lang}:${title}`;
  const cached = articleSummaryCache.get(cacheKey);

  floatingTooltipEl.innerHTML = `
    <div class="wiki-tooltip-title">${escapeHtml(title)}</div>
    <div class="wiki-tooltip-extract">${escapeHtml(cached ?? 'Carregando resumo da Wikipédia...')}</div>
  `;
  floatingTooltipEl.classList.remove('hidden');
  positionFloatingTooltip(target);

  if (!cached) {
    fetchArticleSummary(lang, title).then((summary) => {
      if (activeTooltipTarget === target) {
        floatingTooltipEl.innerHTML = `
          <div class="wiki-tooltip-title">${escapeHtml(title)}</div>
          <div class="wiki-tooltip-extract">${escapeHtml(summary)}</div>
        `;
        positionFloatingTooltip(target);
      }
    });
  }
});

// Inicializa o Side Panel lendo chrome.storage.session
getMatchState()
  .then((state) => renderApp(state))
  .catch(() => renderApp(createInitialMatchState()));

// Atualiza a UI do Side Panel via mensagens diretas do Service Worker
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === 'STATE_UPDATED') {
    renderApp(message.payload);
  }
});

// Atualiza a UI do Side Panel sempre que chrome.storage.session mudar
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'session' && changes[SESSION_STORAGE_KEY]?.newValue) {
    renderApp(changes[SESSION_STORAGE_KEY].newValue as ActiveMatchState);
  }
});
