# VisionNews

Portal editorial de animes em português brasileiro. Inclui guias e ensaios, reviews demonstrativos, calendário por dia/plataforma, quiz, trilhas de leitura e favoritos locais.

## Administração

Acesse `/admin` no endereço hospedado e entre com a conta ChatGPT autorizada. O painel gerencia as **novas matérias**: criação, rascunhos, edição, prévia, publicação e arquivamento. Os 16 textos estáticos da edição demonstrativa ainda ficam em `public/app.js` e `public/explore.js`.

Notícias publicadas exigem fonte HTTPS. O editor visual oferece negrito, itálico, títulos, subtítulos, listas, citações, links HTTPS e desfazer/refazer. A formatação é salva em um documento estruturado `rich-v1`, validado no servidor e renderizado com escape de texto; HTML arbitrário não é aceito. Textos antigos em formato simples continuam compatíveis.

Capas são referenciadas por URL, com prévia e aviso de falha no formulário. A imagem também aparece na leitura completa; o navegador envia a solicitação sem referência da página. Upload de arquivos ainda não foi implementado.

Na aba **Reviews**, informe o anime avaliado, a nota opcional de 0 a 10 e o veredito. As reviews publicadas aparecem tanto na seleção de conteúdos quanto na área de reviews do portal.

Na aba **Calendário de animes**, crie exibições com título, dia, horário de Brasília (opcional), plataforma, link oficial, idioma/formato, ano, trimestre, episódio e imagem. Apenas exibições publicadas entram no calendário da temporada selecionada. Um horário vazio aparece como “A confirmar”. Dublagem e exibição legendada podem ser cadastradas separadamente. Rascunhos e arquivados ficam fora da API pública. A lista pública mostra até 200 matérias e o painel até 1.000. Não há agendamento automático, usuários adicionais ou histórico completo de versões nesta etapa.

A API valida as permissões no servidor usando os cabeçalhos de identidade confiáveis do gateway Sites e a variável privada `ADMIN_EMAIL`. Não basta esconder botões ou conhecer o endereço do painel. Escritas exigem origem igual, JSON e versão atual do registro. Rascunhos/arquivados não são retornados pela API pública. Não existem senhas ou chaves no código.

## Executar

Requer Node.js 22.12 ou superior. Sem dependências externas.

```sh
npm run build
npm test
node --experimental-sqlite scripts/preview.mjs
```

Para testar o editor **apenas localmente**, com identidade simulada e SQLite separado:

```sh
node --experimental-sqlite scripts/preview.mjs --admin
```

A prévia escuta somente em `127.0.0.1:4173`; os dados locais ficam em `.data/`, fora do Git. Não use a simulação de identidade em servidores expostos.

## Estrutura

- `public/`: portal e painel administrativo.
- `server/worker.mjs`: API, autorização e distribuição de arquivos.
- `scripts/build.mjs`: empacota os arquivos no Worker ESM.
- `drizzle/`: migração SQLite/D1, aplicada antes da publicação.
- `tests/`: fluxos de publicação, permissões, conflitos e recursos do portal.
- `.openai/hosting.json`: identidade do Site e vínculo D1 `DB`.

## Hospedagem

A versão atual usa Sites com Cloudflare Worker e D1 persistente. `npm run build` gera `dist/server/index.js`; o pacote de publicação também precisa da configuração de hospedagem e migrações. O GitHub armazena o código: **push neste repositório não publica automaticamente o Site**. A sincronização com a hospedagem é feita separadamente.

Configure `ADMIN_EMAIL` no ambiente privado da hospedagem, nunca em arquivos públicos. A autorização depende dos cabeçalhos verificados pelo gateway Sites: em outra hospedagem, substitua esse mecanismo por uma sessão validada no servidor antes de disponibilizar o painel. Não aceite esses cabeçalhos diretamente da internet.

O site permanece privado. Abrir acesso público é uma etapa separada; o painel continuará exigindo a conta autorizada.

## Conteúdo e pendências editoriais

A grade da temporada é preenchida pela redação no painel; a prévia com horários fictícios continua opcional e identificada. Não hospedamos episódios. Textos da edição demonstrativa e notas não representam cobertura factual atual. As imagens promocionais são referenciadas externamente; revise direitos de uso, créditos e disponibilidade antes do lançamento comercial. A política editorial, privacidade e termos ainda precisam ser preparados para a abertura pública.
