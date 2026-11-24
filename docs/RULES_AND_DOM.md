# ⚖️ Regras de Navegação & Sanitização (Extensão Manifest V3)

Este documento especifica o controle de página, regras de derrota automática e sanitização de artigos executados pela extensão de navegador.

---

## 1. Controle na Página (Content Script)

Durante uma partida ativa, o Content Script deve modificar e restringir a interface da Wikipédia na aba do jogo:

- **Elementos ocultados/removidos do DOM:**
  - Barra de pesquisa nativa da Wikipédia;
  - Menus laterais e de navegação global;
  - Links de troca de idioma (interwiki);
  - Rodapé da página.
- **Restrição de Links:**
  - Desabilitar links que não apontam para artigos válidos do namespace principal (ex.: `Especial:`, `Categoria:`, `Ficheiro:`, `Ajuda:`, `Wikipédia:`, `Portal:` e links externos).
- **Prevenção de Novas Abas:**
  - Interceptar eventos `click` e `auxclick` (clique com botão do meio / `Ctrl+Click`) para impedir a abertura de links em novas abas ou janelas a partir da aba do jogo.

---

## 2. Infrações & Derrota Automática (`webNavigation` e `tabs`)

O Service Worker da extensão monitora os eventos de navegação vinculados ao `tabId` da partida. As seguintes ações resultam em **derrota automática imediata**:

1. **Botões Voltar ou Avançar do navegador:**
   - Detectado via qualificador de transição `forward_back` na API `chrome.webNavigation`.
2. **Digitar URL manualmente na barra de endereços:**
   - Detectado via tipo/qualificador de transição `typed` na API `chrome.webNavigation`.
3. **Abrir outra aba da Wikipédia durante a partida:**
   - O round é estritamente vinculado a um único `tabId`. Qualquer abertura ou navegação paralela em outra aba da Wikipédia invalida a partida.

### Ações Permitidas
- **`Ctrl+F` (Busca na página):** O atalho nativo do navegador para buscar texto na página atual é **oficialmente permitido**.

---

## 3. Sanitização de Artigos

Para garantir consistência entre o que o jogador vê no navegador e o que a API valida:

- **Redirecionamentos:**
  - Sempre normalizar o título canônico do artigo diretamente pelo HTML carregado na página através da tag `<link rel="canonical" href="...">`.
- **Âncoras Internas (`#seção`):**
  - Ignorar navegações em que apenas o `#hash` da URL muda sem alteração no `pathname` (ex.: cliques no índice do próprio artigo ou notas de rodapé).
- **Páginas de Desambiguação:**
  - Identificar páginas de desambiguação via marcadores do DOM e via propriedade `pageprops=disambiguation` da MediaWiki API, excluindo-as como destino válido no sorteio de partidas.
