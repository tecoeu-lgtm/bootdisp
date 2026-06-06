# JusPrevConecta

Sistema para controle de atendimentos, calculos, seguranca e captacao juridica/previdenciaria por WhatsApp Business e email.

## O que ja existe

- Painel de indicadores.
- Inbox unificada com conversas de WhatsApp e email.
- Filtro por canal e status.
- Busca por cliente, telefone, email e assunto.
- Detalhe do atendimento com historico de mensagens.
- Painel de dados do contato.
- Campo de resposta/observacao.
- Tela de login local para demonstracao.
- Login amarrado por sessao do navegador: ao abrir uma nova sessao do sistema, o acesso volta para a tela de login.
- Indicador de internet ativa/offline no topo do painel.
- Fila de sincronizacao offline para acoes feitas quando a API nao responde.
- Banco offline no navegador usando IndexedDB, separado por usuario e maquina.
- Tela "Sincronizacao" para ver pendencias locais, sincronizar manualmente e descartar registros travados.
- Botao de sincronizacao manual e tentativa automatica quando a internet volta.
- Tela de atendimento compacta, com rolagem interna nos paineis e sem rolagem no corpo em desktop.
- Cadastro de contatos com persistencia no navegador.
- Data e hora de criacao/retorno nos atendimentos.
- Respostas prontas predefinidas e personalizaveis.
- Envio de mensagem para o historico da conversa.
- Modulo "Disparos" para preparar filas de WhatsApp e email:
  - Cadastro de campanha.
  - Canal WhatsApp ou email.
  - Mensagem, assunto, destinatarios e agendamento.
  - Persistencia no banco e registro em auditoria.
  - Preparado para integracao posterior com WhatsApp Business Cloud API e provedor de email.
  - Endpoint seguro para processar disparos agendados por cron.
- Tela "Documentos" com papel timbrado JusPrevConecta para impressao ou salvamento em PDF pelo navegador.
- Modulo de calculos assistidos:
  - Judicial e previdenciario.
  - Modelos: livre/revisao manual, trabalhista assistido e previdenciario-atrasados.
  - Campos de principal, correcao, juros e honorarios/outros.
  - Total estimado e status de revisao tecnica.
  - Persistencia via API/PostgreSQL.
- Identidade visual JusPrevConecta com logo propria em versao recortada para login e menu lateral.
- Login real via API e banco PostgreSQL.
- Cadastro e edicao de usuarios com perfis: administrador, atendente, advogado, calculista e SDR.
- Tela "Minha conta" com alteracao de senha.
- Menu filtrado por permissao de perfil.
- Token de sessao assinado para proteger rotas da API.
- Rotas de conversas, modelos, calculos e usuarios exigem autenticacao.
- Cadastro/listagem de usuarios restrito ao perfil administrador.
- Logs de auditoria para registrar login, falha de login, criacao de usuarios, contatos, mensagens, modelos, calculos e alteracao de senha.
- Tela "Auditoria" restrita a administradores.
- Filtros da Auditoria por acao, usuario e periodo.
- Tela "Seguranca" restrita a administradores.
- Chave de registro do sistema validada por segredo de ambiente.
- Configuracao de contas SMTP dentro da tela "Seguranca", com senha criptografada no banco.
- Diagnostico do banco com status PostgreSQL e totais salvos em conversas, mensagens, modelos, calculos, usuarios e auditoria.
- Diagnostico do banco tambem inclui disparos preparados.
- Indicador de tempo restante da sessao no topo do painel e encerramento automatico ao expirar.
- Respostas da API com `Cache-Control: no-store` e `X-Content-Type-Options: nosniff`.
- Estrutura de controle multiusuario no banco com `updated_at`, `updated_by` e `version` nas tabelas principais.
- Ferramenta de atualizacao remota via `npm run remote:update`.
- Tela "Relatorios" com indicadores operacionais:
  - Atendimentos abertos, concluidos, retornos de hoje e atrasados.
  - Distribuicao por status e canal.
  - Produtividade por mensagens, retornos futuros e modelos prontos.
  - Total estimado dos calculos judiciais/previdenciarios e media por calculo.
  - Disparos preparados, destinatarios em fila, usuarios, auditoria e status do banco.
  - Exportacao CSV dos indicadores.
- Disparo real de WhatsApp/e-mail preparado no modulo Disparos, condicionado as credenciais oficiais do ambiente.
- Exclusao auditada de usuarios, contatos/atendimentos, modelos, calculos e disparos.

## Acesso inicial

```text
Email: admin@jusprevconecta.com
Senha: JusPrev@2026
```

Troque a senha inicial na tela "Minha conta" no primeiro acesso.

## Rodar localmente

```bash
npm install
npm run dev
```

Acesse:

```text
http://127.0.0.1:5173
```

## Rodar com backend e banco local

```bash
npm run dev:full
```

Esse comando inicia:

- Frontend Vite.
- API local em `http://127.0.0.1:4000`.
- Banco SQLite em `server/data/controle360.sqlite`.

Para testar a API:

```bash
curl http://127.0.0.1:4000/api/health
```

Para usar registro do sistema no ambiente local, configure `SYSTEM_REGISTRATION_KEY`.

## API em producao

O projeto tambem possui rotas serverless em `api/` para rodar na Vercel usando PostgreSQL.

Para ativar o banco em producao:

1. Crie um banco PostgreSQL na Vercel, Neon, Supabase ou outro provedor.
2. Configure a variavel `DATABASE_URL` no projeto da Vercel.
3. Configure `SESSION_SECRET` e `SYSTEM_REGISTRATION_KEY`.
4. Faca um novo deploy.

As tabelas sao criadas automaticamente na primeira chamada da API.

## Ativar WhatsApp e e-mail

Configure estas variaveis na Vercel em Project Settings > Environment Variables:

```text
WHATSAPP_ACCESS_TOKEN=token_permanente_meta
WHATSAPP_PHONE_NUMBER_ID=id_do_numero_whatsapp_business
WHATSAPP_GRAPH_VERSION=v23.0

SMTP_HOST=smtp.seudominio.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=usuario_smtp
SMTP_PASS=senha_smtp
EMAIL_FROM=JusPrevConecta <atendimento@seudominio.com>
```

Para mais de uma conta de e-mail, prefira uma unica variavel segura chamada `EMAIL_ACCOUNTS_JSON`:

```json
[
  {
    "id": "atendimento",
    "label": "Atendimento",
    "host": "smtp.seudominio.com",
    "port": 587,
    "secure": false,
    "user": "atendimento@seudominio.com",
    "pass": "senha_smtp",
    "from": "JusPrevConecta <atendimento@seudominio.com>"
  },
  {
    "id": "financeiro",
    "label": "Financeiro",
    "host": "smtp.seudominio.com",
    "port": 587,
    "secure": false,
    "user": "financeiro@seudominio.com",
    "pass": "senha_smtp",
    "from": "JusPrevConecta Financeiro <financeiro@seudominio.com>"
  }
]
```

Depois de salvar as variaveis, faca novo deploy. O modulo Disparos mostrara WhatsApp/e-mail como ativos quando as credenciais estiverem presentes. Para e-mail, a campanha permite escolher a conta de envio configurada.

Tambem e possivel configurar e-mail pela interface:

1. Entre como administrador.
2. Abra `Seguranca`.
3. Em `Contas de e-mail`, cadastre SMTP, porta, usuario, remetente e senha de app.
4. Clique em `Adicionar conta`.
5. Clique em `Salvar configuracao`.

As contas cadastradas pela interface ficam no banco com a senha criptografada. Para Gmail, use `smtp.gmail.com`, porta `587`, SSL desligado, e uma senha de app do Google.

## Build

```bash
npm run build
```

## Atualizacao remota

Em um computador autorizado e ja conectado a Vercel, rode:

```bash
npm run remote:update
```

Esse comando valida o projeto com build e publica em producao.

## Disparos agendados

O endpoint seguro para processar campanhas agendadas e:

```text
GET /api/broadcasts?cron=send-scheduled
Authorization: Bearer SEU_CRON_SECRET
```

Configure `CRON_SECRET` nas variaveis da Vercel antes de ativar uma chamada recorrente externa ou um Vercel Cron. O endpoint processa campanhas vencidas com status `agendado` ou `fila_preparada`.

## Impressao

O navegador nao permite listar impressoras instaladas no Windows por seguranca. O sistema usa `window.print()`, que abre a janela de impressao do Windows e permite escolher a impressora configurada ou salvar em PDF.

## Proximas etapas

1. Criar recuperacao de acesso por email e renovacao controlada da sessao.
2. Refinar permissoes por perfil em cada acao sensivel.
3. Evoluir formulas de calculos judiciais e previdenciarios com validacao tecnica.
4. Adicionar campos de area, frente, agente responsavel e encaminhamento entre frentes no banco.
5. Criar controle de opt-in/opt-out e consentimento para campanhas.
6. Adicionar exportacao PDF nativa para relatorios.
7. Medir tempo medio de resposta, conversao e ROI por origem.
8. Implementar webhooks de entrada do WhatsApp/e-mail.
9. Criar aplicativo auxiliar Windows apenas se for necessario imprimir sem a janela do navegador.

## Persistencia atual

Nesta versao, o frontend usa a API local quando `VITE_API_URL` esta configurado. Se a API nao estiver disponivel, ele usa armazenamento local como fallback e registra a acao na fila de sincronizacao em IndexedDB.

Quando a conexao volta, a fila tenta reenviar:

- contatos/atendimentos;
- modelos de resposta;
- calculos;
- disparos;
- usuarios.

Esta e a primeira camada offline por usuario e por maquina. A proxima evolucao recomendada e adicionar IDs locais estaveis em todos os registros, baixar uma copia consultavel dos dados essenciais e criar resolucao visual de conflitos quando dois usuarios editarem o mesmo registro.

## Observacao sobre WhatsApp

Para ambiente real, use a API oficial do WhatsApp Business Cloud API. Evite automacoes sobre WhatsApp Web, pois podem causar bloqueios e violar regras da plataforma.
