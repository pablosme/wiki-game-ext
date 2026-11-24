# 🗺️ Roadmap & Próximos Passos

---

## Faseamento do Projeto

### Fase 1 — Core Jogável (Extensão + API Stateless)
- Extensão Manifest V3 com bloqueios de DOM, derrota automática em infrações, `Ctrl+F` liberado e sanitização canônica;
- API stateless com emissão de *challenge token* assinado (HMAC/JWT) e validação unificada de caminho + pontuação dinâmica;
- Pool estático de artigos (`pool-<idioma>.json`) usado exclusivamente para sortear início e fim da partida, gerado por uma **pipeline automatizada** de busca e categorização;
- Progresso da navegação salvo em runtime na sessão da extensão (`chrome.storage.session`), permitindo navegar por qualquer artigo da Wikipédia;
- **Modo Livre** e **Desafio do Dia determinístico** (`YYYY-MM-DD` + idioma, com resumo compartilhável, sem leaderboard).

### Fase 2 — PvP 1v1 em Salas Privadas
- Criação de salas privadas por código/link com estado efêmero em tempo real (memória, Redis, Durable Objects ou WebRTC);
- Reutilização completa do motor de regras, modificadores e validação da Fase 1.

### Fase 3 — Persistência & Leaderboard
- Adição de banco de dados persistente;
- **Leaderboard por idioma** para o Desafio do Dia (e avaliação de contas/histórico).

---

## 📋 Checklist de Próximos Passos

- [ ] Definir nome definitivo do projeto
- [ ] Investigar na prática as APIs da Wikimedia (MediaWiki Action API, Pageviews, Lift Wing Outlink Topic Model e dumps) e prototipar o "mapa de calor"
- [ ] Definir layout ideal da UI na página da Wikipédia (overlay vs. sidebar/Side Panel vs. barra fixa)
- [ ] Especificar a fórmula inicial de pontuação dinâmica e a lista de modificadores da Fase 1
- [ ] Escolher stack técnica da extensão (Manifest V3) e da API stateless
- [ ] Criar repositório no GitHub e iniciar protótipo da Fase 1
