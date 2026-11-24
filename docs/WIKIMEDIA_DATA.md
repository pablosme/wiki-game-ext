# 📚 Dados da Wikipédia, Classificação & Direitos de Uso

Este documento descreve como os dados da Wikimedia são utilizados, licenciados e pré-processados para o funcionamento do jogo.

---

## 1. Licenças e Limites de Uso

- **Wikipédia (CC BY-SA 4.0):**
  - Como a extensão executa diretamente no navegador do usuário sobre o site oficial da Wikipédia, não há redistribuição de artigos pelo nosso servidor — apenas leitura de metadados e manipulação local do DOM.
- **Wikidata (CC0 — Domínio Público):**
  - Uso livre para metadados estruturados.
- **APIs da Wikimedia:**
  - Gratuitas, porém **exigem obrigatoriamente o header `User-Agent`** identificando a aplicação e contato.
  - Impõem *rate limits* que não devem ser violados em runtime.
  - Para grandes volumes de dados ou construção de grafos de links, devem ser utilizados os dumps oficiais (`dumps.wikimedia.org`).

---

## 2. Seleção de Artigos & "Mapa de Calor"

Para evitar artigos obscuros ou becos sem saída, e permitir calibrar a dificuldade das partidas sem depender de banco de dados em runtime:

- **Fontes combinadas:**
  1. **Pageviews** (popularidade dos artigos por idioma);
  2. **Dumps de `pagelinks`** (*in-degree* e conectividade do artigo na rede de links).
- **Resultado:**
  - Geração de um **pool estático somente leitura** (arquivos `pool-<idioma>.json` commitados junto ao código da API Serverless), utilizado **exclusivamente para sortear o artigo inicial e o artigo objetivo**.
  - Durante a partida, a navegação não é restrita ao `pool`: o jogador pode navegar livremente por qualquer artigo válido da Wikipédia, mantendo o progresso em runtime (`chrome.storage.session`).
  - Uma pipeline automatizada (script Node.js/TypeScript + CI/CD) busca, categoriza (popularidade, conectividade e tópicos Lift Wing) e atualiza esses arquivos JSON periodicamente.
  - Exclusão prévia de páginas de desambiguação (`pageprops=disambiguation`).

---

## 3. Classificação de Tópicos nos Modificadores

Os modificadores de round podem aplicar bônus ou penalidades quando o jogador passa por determinados temas.

- **Por que não usar as categorias nativas da Wikipédia?**
  - As categorias nativas da Wikipédia são irregulares, folclóricas e excessivamente granulares.
- **Solução adotada — Outlink Topic Model (Lift Wing API):**
  - Explorar o modelo **Outlink Topic Model** hospedado no **Lift Wing API** da Wikimedia.
  - Classifica qualquer artigo em uma taxonomia limpa e padronizada de **~64 tópicos de alto nível** (ex.: `STEM.Physics`, `Culture.Sports`, `History_and_Society.History`).

---

## 4. Performance e Pré-processamento

- Pré-processar e cachear os dados de artigos, conectividade e tópicos no backend.
- Isso evita latência durante a partida e previne bloqueios por *rate limit* nas APIs da Wikimedia durante a criação e validação de rounds.
