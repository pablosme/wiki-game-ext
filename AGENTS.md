# AGENTS.md — Diretrizes e Instruções do Projeto (Wikipedia Game)

Este documento centraliza as diretrizes arquiteturais, regras de negócio e restrições técnicas do **Wikipedia Game**, extraídas da especificação oficial no Notion.

---

## 1. Visão Geral

O **wikipedia-game** é composto por dois repositórios separados: uma extensão de navegador (**Manifest V3**) e uma **API Serverless Stateless** agnóstica de plataforma, que transformam a navegação na Wikipédia real em um jogo competitivo e dinâmico.

### Princípios Fundamentais (V1)
1. **100% Stateless na V1:** Sem contas de usuário e sem banco de dados persistente na Fase 1.
2. **Validação Unificada no Servidor:** Todos os modos de jogo (incluindo Jogo Livre e Desafio do Dia) iniciam e terminam na API através de um token assinado (**JWT**) e validação real do caminho percorrido via MediaWiki Action API e Lift Wing API.
3. **Execução sobre a Wikipédia Real:** A extensão usa a **Chrome Side Panel API** para exibir toda a UI do jogo, manipula o DOM oficial da Wikipédia (`*.wikipedia.org`) via Content Scripts e monitora a navegação via Service Worker (`webNavigation` e `tabs`).
4. **Isolamento por Idioma:** Pools de artigos (`pt` e `en` na Fase 1, com ~5.000 artigos cada), sementes diárias, validações e futuros rankings são estritamente separados por código de idioma.

---

## 2. Componentes do Sistema e Stack Técnica

### A. Extensão de Navegador (`wikipedia-game-ext` — Manifest V3)
- **Stack:** TypeScript + **WXT** + Vanilla TypeScript.
- **Side Panel (Chrome Side Panel API):**
  - Centraliza toda a interface do jogador: menu inicial (seleção de modo, idioma, dificuldade e limites customizáveis de tempo/cliques), acompanhamento da partida em tempo real e resumo final.
- **Content Script:**
  - Sanitiza e bloqueia elementos não permitidos do DOM da Wikipédia (barra de busca, menus laterais, links interwiki/idiomas, rodapé).
  - Desativa links que não sejam artigos válidos (`Especial:`, `Categoria:`, `Ficheiro:`, links externos).
  - Intercepta eventos `click` e `auxclick` para impedir abertura de links em novas abas.
  - Extrai o título canônico do artigo via `<link rel="canonical" href="...">` e detecta páginas de desambiguação.
- **Background Service Worker:**
  - Como o Service Worker do MV3 hiberna após ~30s de inatividade, **todo o estado e progresso da partida ativa deve residir em runtime em `chrome.storage.session`**.
  - Monitora eventos de `chrome.webNavigation` e `chrome.tabs` vinculados ao `tabId` exclusivo da partida.
  - Aplica **derrota automática imediata** caso detecte infrações: uso de Voltar/Avançar (`forward_back`), digitação manual de URL (`typed`), abertura de outra aba da Wikipédia ou estouro dos limites ativos de tempo/cliques.
  - Ignora mudanças apenas de âncora (`#seção`) onde o `pathname` permanece o mesmo.
  - Permite oficialmente o uso de `Ctrl+F` (busca nativa na página).

### B. API Backend (`wikipedia-game-api` — Serverless Stateless)
- **Stack:** TypeScript + Node.js + **Hono** (agnóstico de plataforma via Web Standards, com deploy principal em **Cloudflare Workers**).
- **Emissão de Partida (`start`):**
  - Sorteia origem, destino e modificadores a partir do **pool estático somente leitura** (`pool-pt.json`, `pool-en.json`), usando o `pool` **exclusivamente para definir início e fim** (ou gera deterministicamente via semente `YYYY-MM-DD` + idioma para o Desafio do Dia).
  - Retorna um **JWT** assinado contendo `{ origem, destino, modificadores, limites, idioma, timestamp_inicio }`.
- **Validação e Pontuação (`finish`):**
  - Recebe `{ token, caminho_percorrido }`.
  - Verifica integridade e assinatura do JWT.
  - Valida o anti-cheat em tempo real consultando a **MediaWiki Action API** para confirmar se cada transição `Artigo A -> Artigo B` possui um link real válido na Wikipédia.
  - Calcula a pontuação final a partir da base de **1.000 pontos**, descontando `X * cliques` e `Y * segundos`, e somando/subtraindo linearmente os modificadores ativos do round (pesos de tempo/cliques, tópicos via Lift Wing API e checkpoints).

### C. Pipeline Automatizada do Pool de Dados ("Mapa de Calor")
- Script automatizado em TypeScript/Node.js (executado offline / via CI) que gera arquivos `pool-<idioma>.json` (~5.000 artigos por idioma) combinando:
  - **Pageviews API / Dumps** (popularidade por idioma);
  - **Dumps de `pagelinks`** (faixas de conectividade / *in-degree* para classificar dificuldade em Tiers);
  - **Outlink Topic Model (Lift Wing API)** da Wikimedia (~64 tópicos de alto nível como `STEM.Physics`, `Culture.Sports`) para classificar dificuldade por proximidade de tema e alimentar modificadores de tópico.

---

## 3. Regras de Conformidade com a Wikimedia
- Sempre incluir um header `User-Agent` descritivo em qualquer requisição às APIs da Wikimedia.
- Respeitar *rate limits* oficiais; priorizar pré-processamento, dumps (`dumps.wikimedia.org`) e cache no backend para não sobrecarregar a MediaWiki API durante partidas em tempo real.
- Nenhum conteúdo textual de artigos deve ser redistribuído (a leitura ocorre diretamente no site oficial pelo navegador do usuário, em conformidade com CC BY-SA 4.0, e metadados estruturados seguem CC0 do Wikidata).

---

## 4. Padrão de Comunicação Obrigatório (ASD-STE100 Adaptado)

Todas as respostas do agente neste projeto devem seguir o padrão **ASD-STE100 (Simplified Technical English)**, adaptado para o idioma da conversa (Português ou Inglês):

1. **Voz Ativa:** Use apenas a voz ativa. Exemplo: "A API valida o token" (Correto) vs. "O token é validado pela API" (Incorreto).
2. **Limites de Tamanho:**
   - Escreva frases procedimentais com no máximo 20 palavras.
   - Escreva frases descritivas com no máximo 25 palavras.
   - Limite cada parágrafo a no máximo 6 frases.
3. **Uma Instrução por Frase:** Não combine múltiplas ações na mesma frase. Use listas numeradas para procedimentos sequenciais.
4. **Verbos Simples e Imperativos:**
   - Use o modo imperativo para instruções ("Crie o arquivo", "Valide a assinatura").
   - Use apenas os tempos presente simples, passado simples ou futuro simples. Evite gerúndios e locuções verbais complexas.
5. **Consistência Terminológica (Uma Palavra, Um Significado):**
   - Use um único termo para cada componente do sistema (ex.: use sempre `aba`, nunca alterne com `guia`; use sempre `Service Worker`, `Content Script`, `token`).
   - Evite sinônimos, metáforas, ironias ou advérbios vagos ("simplesmente", "facilmente", "basicamente").
6. **Agrupamento de Substantivos:** Não agrupe mais de três substantivos consecutivos. Use preposições para esclarecer a relação entre os termos.
