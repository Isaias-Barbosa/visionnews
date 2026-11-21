# VisionNews

Portal editorial de animes em português brasileiro. Inclui guias e ensaios, reviews demonstrativos, calendário por dia/plataforma, quiz, trilhas de leitura e favoritos locais.

## Administração

Entre com uma conta ChatGPT autorizada. O **dashboard editorial** em `/dashboard` gerencia notícias, reviews, calendário e recomendações. O **painel administrativo** em `/admin` exibe o inventário editorial por status, o estado do banco e permite autorizar ou remover editores por e-mail.

Notícias e reviews têm seção, categoria editorial livre e até dez tags separadas por vírgulas. O título, o resumo, a categoria e as tags entram na busca da home. As matérias podem ser criadas como rascunho, editadas, pré-visualizadas, publicadas e arquivadas. Os 16 textos estáticos da edição demonstrativa ainda ficam em `public/app.js` e `public/explore.js`.

Notícias publicadas exigem fonte HTTPS. O editor visual oferece negrito, itálico, títulos, subtítulos, listas, citações, links HTTPS e desfazer/refazer. A formatação é salva em um documento estruturado `rich-v1`, validado no servidor e renderizado com escape de texto; HTML arbitrário não é aceito. Textos antigos em formato simples continuam compatíveis.

Capas são referenciadas por URL, com prévia e aviso de falha no formulário. A imagem também aparece na leitura completa; o navegador envia a solicitação sem referência da página. Upload de arquivos ainda não foi implementado.

Na aba **Reviews**, informe o anime avaliado, a nota opcional de 0 a 10 e o veredito. As reviews publicadas aparecem tanto na seleção de conteúdos quanto na área de reviews do portal.

Na aba **Calendário de animes**, crie exibições com título, dia, horário de Brasília (opcional), plataforma, link oficial, idioma/formato, ano, trimestre, episódio e imagem. Apenas exibições publicadas entram no calendário da temporada selecionada. Um horário vazio aparece como “A confirmar”. Dublagem e exibição legendada podem ser cadastradas separadamente. Rascunhos e arquivados ficam fora da API pública. A lista pública mostra até 200 matérias e o painel até 1.000. Não há agendamento de matérias nem histórico completo de versões.

Na aba **Recomendação do dia**, escolha a data, informe o anime, explique por que assistir e adicione até cinco links oficiais de streaming no Brasil. A capa é opcional. Apenas uma indicação pode ser cadastrada por data. Ao salvar como publicada, a home passa a exibi-la na data escolhida pelo horário de Brasília. Sem indicação publicada para hoje, a home aponta para a área de descoberta. A seleção é manual e não requer um cron.

## Radar de notícias RSS

A página **Notícias RSS** em `/rss` (e a aba **Importação RSS** do dashboard) reúne as últimas notícias de várias fontes RSS/Atom. Cadastre uma fonte com nome e URL; o servidor consulta o feed, recusa destinos privados e importa os itens para revisão editorial. A lista pode ser filtrada por fonte e por situação, além de ter busca e paginação.

Ao abrir uma notícia, a ação **Cadastrar notícia** envia o título, o resumo, o texto, a imagem e o link para os campos do editor como rascunho. O item RSS só é marcado como cadastrado depois que o rascunho é salvo, preservando o fluxo de revisão. A opção **Ligar auto** cria rascunhos automaticamente para novos itens de uma fonte, mas a publicação continua manual. A imagem do feed preenche o campo **Imagem de capa**; ao atualizar uma fonte, capas vazias de rascunhos vinculados são recuperadas sem alterar capas já escolhidas.

No dashboard, a lista de notícias e reviews permite marcar rascunhos e usar **Publicar selecionados** para publicar em lote. Cada item passa pela mesma validação do editor: rascunhos sem fonte oficial, sem texto mínimo ou com outro campo inválido são informados e permanecem como rascunho.

A API editorial fica em `/api/editor/rss-feeds`, `/api/editor/rss-items`, `/api/editor/rss/refresh` e `/api/editor/news/bulk-publish`; os aliases `/api/rss/sources`, `/api/rss/articles` e `/api/rss/fetch` atendem integrações que usam o caminho público. Em SQLite/D1 as migrações são `drizzle/0004_rss.sql`, `drizzle/0005_rss_draft_covers.sql`, `drizzle/0006_rss_style.sql` e `drizzle/0007_ingestion_pipeline.sql`; no PostgreSQL, `postgres/999_rss.sql`, `postgres/1000_rss_improvements.sql`, `postgres/1001_rss_draft_covers.sql`, `postgres/1002_rss_style.sql` e `postgres/1003_ingestion_pipeline.sql`. Com o motor ativo, novos itens RSS entram automaticamente na fila `ingestion_queue` — o contador `queued` aparece no retorno do refresh. O processamento usa perfis por fonte: ANMTV prioriza o conteúdo do RSS e só busca o original quando ele é insuficiente; CR News e OtakuPT buscam a página original (removendo redes e duplicações); ANN força tradução PT-BR antes da reescrita. Fatos verificáveis viram sugestões em `ai_suggestions`; falha de extração marca o item para revisão sem inventar notícia. Nada disso cria ou publica notícia: a matéria final continua passando pelo editor. As rotas autenticadas do motor são `/api/editor/pipeline/queue`, `/api/editor/pipeline/enqueue`, `/api/editor/pipeline/process`, `/api/editor/pipeline/retry` (reabre apenas jobs `failed`, sem tocar em `done` ou duplicatas) e `/api/editor/pipeline/suggestions`; `/api/cron/pipeline` aceita um gatilho agendado com `Authorization: Bearer $CRON_SECRET`. No Studio, o botão **Reprocessar falhas** usa essa rota e em seguida dispara o processamento do lote; a publicação continua manual no editor.

A API valida as permissões no servidor usando os cabeçalhos de identidade confiáveis do gateway Sites e a variável privada `ADMIN_EMAIL`. A conta administradora concede permissões editoriais por e-mail em `/admin`. Editores também precisam ter acesso ao Site pela hospedagem. Somente a conta administradora acessa `/admin`. Não basta esconder botões ou conhecer o endereço do painel. Escritas exigem origem igual, JSON e versão atual do registro. Rascunhos/arquivados não são retornados pela API pública. Não existem senhas ou chaves no código. A prévia de tradução usa `DEEPL_API_KEY` ou `DEEPL_AUTH_KEY` por padrão, com fallback automático para `OPENROUTER_API_KEY` se o DeepL falhar (chave inválida ou sem cota); na ausência de DeepL, o OpenRouter é usado diretamente. As chaves ficam exclusivamente no ambiente privado do servidor e a prévia não grava a tradução no banco. O pipeline usa `OPENROUTER_TRANSLATION_MODEL` e `OPENROUTER_EDITORIAL_MODEL` para separar tradução de redação, `OPENROUTER_SITE_URL` para identificação junto ao provedor, `CRON_SECRET` para o gatilho agendado e `PIPELINE_MIN_WORDS` para ajustar o mínimo de palavras da extração. `/api/health` informa apenas qual provedor está configurado, nunca as chaves.

## Executar

Requer Node.js 22.12 ou superior. Sem dependências externas.

```sh
npm run build
npm test
node --experimental-sqlite scripts/preview.mjs
```

Após alterar arquivos em `server/`, rode `npm run build` antes de `npm test`: os testes importam o artefato gerado em `dist/server/index.js`.

Para testar o editor **apenas localmente**, com identidade simulada e SQLite separado:

```sh
node --experimental-sqlite scripts/preview.mjs --admin
```

A prévia escuta somente em `127.0.0.1:4173`; os dados locais ficam em `.data/`, fora do Git. Não use a simulação de identidade em servidores expostos.

## Estrutura

- `public/`: portal e painel administrativo.
- `server/worker.mjs`: API, autorização e distribuição de arquivos.
- `scripts/build.mjs`: empacota os arquivos no Worker ESM.
- `drizzle/`: migração SQLite/D1, aplicada antes da publicação. `drizzle/meta/_journal.json` cobre `0000`–`0003`; as migrações `0004+` são aplicadas explicitamente pelos scripts de preview e hospedagem.
- `tests/`: fluxos de publicação, permissões, conflitos e recursos do portal.
- `.openai/hosting.json`: identidade do Site e vínculo D1 `DB`.

## Hospedagem

A versão atual usa Sites com Cloudflare Worker e D1 persistente. `npm run build` gera `dist/server/index.js`; o pacote de publicação também precisa da configuração de hospedagem e migrações. O GitHub armazena o código: **push neste repositório não publica automaticamente o Site**. A sincronização com a hospedagem é feita separadamente.

Configure `ADMIN_EMAIL` no ambiente privado da hospedagem, nunca em arquivos públicos. A autorização depende dos cabeçalhos verificados pelo gateway Sites: em outra hospedagem, substitua esse mecanismo por uma sessão validada no servidor antes de disponibilizar o painel. Não aceite esses cabeçalhos diretamente da internet.

O site permanece privado. Abrir acesso público é uma etapa separada; o painel continuará exigindo a conta autorizada.

## Conteúdo e pendências editoriais

A grade da temporada é preenchida pela redação no painel; a prévia com horários fictícios continua opcional e identificada. Não hospedamos episódios. Textos da edição demonstrativa e notas não representam cobertura factual atual. As imagens promocionais são referenciadas externamente; revise direitos de uso, créditos e disponibilidade antes do lançamento comercial. A política editorial, privacidade e termos ainda precisam ser preparados para a abertura pública.

## Vercel e Neon

- Configure o projeto Vercel com o repositório e as opções de `vercel.json`. O build usa Node 22 ou superior.
- Conecte um banco **dedicado ao VisionNews** no Neon. Configure a URL com pool de conexões como `DATABASE_URL` e uma chave aleatória como `BETTER_AUTH_SECRET`, ambas no ambiente privado da Vercel. Para domínio próprio ou execução local, defina `BETTER_AUTH_URL` com a origem exata.
- Um build de produção com `DATABASE_URL` aplica as migrações em `postgres/` automaticamente, em ordem, e registra o que já foi aplicado em `visionnews_migrations`. Não é necessário colar os arquivos no SQL Editor do Neon. Para aplicar manualmente fora do build, prefira `npm run db:migrate` com `DATABASE_URL` configurada; se for usar o SQL Editor, execute na ordem `0001_initial.sql`, `0002_news_feature.sql`, `999_rss.sql`, `1000_rss_improvements.sql`, `1001_rss_draft_covers.sql`, `1002_rss_style.sql` e `1003_ingestion_pipeline.sql`. Consulte `/api/readiness` para verificar a configuração da conta e do banco.
- Para preservar os conteúdos editoriais, exporte o D1 completo em SQL e execute `npm run db:import -- caminho/do/export.sql` contra o banco já migrado, antes de criar conteúdo editorial no novo destino. Faça o corte após conferir a cópia. O script mantém os IDs e rejeita um destino com conteúdo.
- Configure `ADMIN_EMAIL` no servidor e crie a primeira conta com `npm run admin:create` em um terminal seguro, usando também `DATABASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` e a senha inicial em `ADMIN_INITIAL_PASSWORD`. Use uma senha nova e remova a variável inicial depois. O script recusa endereços que já tenham uma conta. Para editores, autorize a conta por e-mail no painel e verifique sua identidade antes de marcar a conta como verificada no PostgreSQL.
- Contas da watchlist são do VisionNews. Leituras salvas são locais ao navegador e à origem. A versão inicial usa cadastro por e-mail e senha, sem confirmação ou recuperação por e-mail para leitores.

### IA, tradução e itens falhados

- Configurar a variável no painel da Vercel não altera deploys já publicados. Depois de salvar `OPENROUTER_API_KEY` (e, se usar, `DEEPL_API_KEY` ou `DEEPL_AUTH_KEY`), faça um **novo deploy** para que o runtime das funções receba o valor.
- Confira o **escopo da variável**: ela precisa existir em **Production** para o domínio de produção, ou em **Preview** se você estiver abrindo a URL de preview. Um valor configurado só em Development não aparece nos outros ambientes.
- Confira o nome exato, sem espaços ou prefixos: `OPENROUTER_API_KEY`, `OPENROUTER_TRANSLATION_MODEL` e `OPENROUTER_EDITORIAL_MODEL`. Variáveis `NEXT_PUBLIC_*` são públicas e não devem ser usadas para chaves.
- Abra `GET /api/health` **no mesmo domínio** onde o erro apareceu. A resposta traz `ai.translation.{provider,model,configured}` e `ai.editorial.{provider,model,configured}` e nunca mostra as chaves. Se `ai.editorial.configured` estiver `false`, a chave do OpenRouter não chegou àquele runtime — confira escopo, nome e redeploy.
- Quando `ai.translation.provider` estiver `deepl` e a chave do DeepL estiver inválida ou sem cota, a tradução usa o OpenRouter como fallback **somente se** `ai.editorial.configured` estiver `true`. Para usar o OpenRouter diretamente na tradução, remova as variáveis do DeepL e mantenha apenas `OPENROUTER_API_KEY`.
- Itens que falharam enquanto a chave estava ausente ficam com status `Falhou` na fila. No Studio, clique em **Reprocessar falhas**: a rota `/api/editor/pipeline/retry` reabre apenas esses jobs como `pending`, limpa o erro e dispara o processamento do lote em seguida. Itens `Concluído` e duplicatas não são alterados, e nenhuma matéria é publicada automaticamente.
