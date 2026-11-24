# wikipedia-game-ext

Extensão de navegador (**Manifest V3**) para o projeto **wikipedia-game**, construída com **WXT**, **Vanilla TypeScript** e **Chrome Side Panel API**.

---

## Componentes

1. **Chrome Side Panel (`entrypoints/sidepanel/`):**
   - Menu inicial para escolha de modo (Jogo Livre ou Desafio do Dia), idioma (`pt`, `en`), dificuldade por faixa de conectividade e limites customizáveis de tempo e cliques (com opção de desligar).
   - Painel em tempo real com cronômetro, cliques, modificadores ativos e caminho percorrido.
   - Resumo final validado pela API com detalhamento da pontuação e cópia de resumo compartilhável.
2. **Background `Service Worker` (`entrypoints/background.ts`):**
   - Mantém todo o estado da partida ativa em runtime dentro de `chrome.storage.session`.
   - Monitora `chrome.webNavigation` e `chrome.tabs` para aplicar derrota automática imediata em infrações (`forward_back`, `typed`, abertura de outra aba da Wikipédia ou estouro de limites).
3. **`Content Script` (`entrypoints/content.ts`):**
   - Oculta barra de pesquisa, menus laterais, links de idioma e rodapé da Wikipédia durante a partida.
   - Desativa links que não apontam para artigos válidos (`Especial:`, `Categoria:`, `Ficheiro:`, links externos).
   - Intercepta `click` e `auxclick` para impedir abertura em novas abas, mantendo `Ctrl+F` liberado.
   - Extrai o título canônico via `<link rel="canonical" href="...">`.

---

## Comandos

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Execute os testes automatizados:
   ```bash
   npm test
   ```
3. Gere o pacote de produção da extensão (`.output/chrome-mv3`):
   ```bash
   npm run build
   ```
4. Inicie o modo de desenvolvimento do WXT:
   ```bash
   npm run dev
   ```
