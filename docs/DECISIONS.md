# 📋 Decisões e Pendências do Projeto

Este arquivo registra as definições aprovadas e as decisões pendentes para a Fase 1 do projeto `wikipedia-game`.

---

## ✅ 1. Identidade e Estrutura de Repositórios (Definido)

- **1.1 Nome inicial do projeto:** `wikipedia-game` (sujeito a alteração futura).
- **1.2 Estrutura de repositórios:** Dois repositórios separados (um repositório para a Extensão Manifest V3 e um repositório para a API Stateless / dados).

---

## ✅ 2. Stack Tecnológica (Definido)

- [x] **2.1 Extensão (Manifest V3):** TypeScript + WXT + Vanilla TypeScript (manipulação nativa do DOM / Web Components).
- [x] **2.2 API Stateless:** TypeScript + Node.js + **Hono** (arquitetura Serverless agnóstica de plataforma, usando Web Standards / Fetch API, com alvo principal de deploy em **Cloudflare Workers**).
- [x] **2.3 Pipeline de Dados (`pool` estático):**
  - **Escopo estrito do `pool`:** Os arquivos JSON estáticos (`pool-<idioma>.json`) servem **exclusivamente para sortear os artigos de início e fim** da partida.
  - **Navegação livre em runtime:** O jogador navega por qualquer artigo válido da Wikipédia real. O progresso do caminho fica salvo em runtime na sessão da extensão (`chrome.storage.session`) e a validação final consulta a API da Wikipédia em tempo real.
  - **Automação (Feature da Fase 1):** Criar uma pipeline automatizada em TypeScript/Node.js (ex.: CLI + GitHub Actions) no repositório da API para buscar, filtrar (excluir desambiguações), categorizar (Pageviews + conectividade + tópicos via Lift Wing API) e atualizar os arquivos `pool-<idioma>.json`.

---

## ✅ 3. Interface do Usuário — UI (Definido)

- [x] **3.1 Formato da UI durante a partida:** **Chrome Side Panel API** (painel lateral nativo do navegador, separado do DOM da Wikipédia, mantendo o `Content Script` focado apenas na sanitização, bloqueio de elementos e captura de eventos da página).
- [x] **3.2 Ponto de entrada da partida:** **Side Panel nativo** (o menu inicial de seleção de modo/idioma, o acompanhamento da partida em tempo real e o resumo final ficam centralizados no Side Panel).

---

## ✅ 4. Regras de Jogo e Pontuação da Fase 1 (Definido)

- [x] **4.1 Fórmula de pontuação:**
  - Pontuação inicial base: **1.000 pontos**.
  - Cálculo final aditivo/subtrativo uniforme: `Pontuação = 1000 - (X * cliques) - (Y * segundos) + Σ(modificadores)`.
  - Todos os multiplicadores e modificadores seguem o mesmo formato linear (descontando ou adicionando pontos com base na contagem do evento).
- [x] **4.2 Catálogo de modificadores (Fase 1):**
  1. Multiplicadores dinâmicos de peso para **tempo concluído** e **quantidade de cliques**;
  2. **Bonificação ou penalidade** por passagem em determinados **tópicos** (classificados via Outlink Topic Model / Lift Wing API);
  3. **Checkpoint** (parada obrigatória ou opcional em um artigo intermediário, adicionando bônus ou descontando penalidade).
- [x] **4.3 Limites de partida:**
  - Limites máximos de **tempo** e de **cliques** suportados e **customizáveis** na criação da partida (com opção de **desligar** os limites).
- [x] **4.4 Idiomas iniciais:** Português (`pt`) e Inglês (`en`).

---

## ✅ 5. Contrato da API e Validação (Definido)

- [x] **5.1 Formato e expiração do token:** **JWT (JSON Web Token)** assinado via `HMAC-SHA256` (Web Crypto API, compatível com qualquer ambiente Serverless).
- [x] **5.2 Estratégia de validação de links:** Consulta em tempo real (e em paralelo) à **MediaWiki Action API** para validar cada transição `Artigo N -> Artigo N+1` e à **Lift Wing API** para validar tópicos dos artigos visitados quando houver modificador de tópico ativo.

---

## ✅ 6. Pool de Artigos e "Mapa de Calor" (Definido)

- [x] **6.1 Tamanho do pool:** **Médio (~5.000 artigos por idioma)** em arquivos `pool-pt.json` e `pool-en.json` (~750 KB cada, ideal para bundle Serverless).
- [x] **6.2 Cálculo de dificuldade:** Classificação por **faixas de conectividade/popularidade (Tiers)** combinada com proximidade de **tópico (Lift Wing)**:
  - **Fácil:** Artigos altamente conectados/populares (Tier 1) dentro do mesmo macro-tópico.
  - **Médio:** Artigos de conectividade intermediária (Tier 2) ou em tópicos distintos.
  - **Difícil:** Artigo objetivo com menor conectividade (*in-degree* menor / Tier 3) e tópico distante do artigo inicial.
