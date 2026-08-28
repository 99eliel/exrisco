# EXRisco

Sistema PWA para acompanhamento da estratificação de risco e vigilância de pacientes por posto de saúde, conectado ao projeto Firebase `extratificacao`.

## Situação atual

A primeira base funcional contém:

- login por Firebase Authentication;
- administrador geral e uma enfermeira responsável vinculada a cada posto;
- isolamento de pacientes por `postoId` nas regras do Firestore;
- cadastro central do paciente, evitando duplicidade entre acompanhamentos;
- Hipertensão, Diabetes, Gestação e Saúde da Criança;
- campos e seletores estruturados a partir da planilha de vigilância fornecida;
- cálculo de idade e preenchimento auxiliar da DPP a partir da DUM;
- consolidação do maior nível de risco do paciente;
- próximo retorno e alertas de retornos vencidos;
- painel com pacientes ativos, alto risco, retornos vencidos e pendências;
- filtros por acompanhamento, risco, posto e situação;
- histórico de criação, edição, arquivamento e reativação;
- arquivamento sem exclusão definitiva de pacientes;
- exportação CSV e relatório para impressão;
- administração de postos e usuários;
- criação de novos usuários sem derrubar a sessão do administrador;
- PWA com atualização de cache por versão;
- validação estática automática pelo GitHub Actions.

A **Calculadora de Estratificação de Riscos do Estado de Goiás** é uma ferramenta auxiliar independente. Ela pode ser aberta pelo ícone da calculadora dentro do EXRisco ou em nova aba. Nenhum dado do prontuário é enviado automaticamente para a calculadora e nenhum resultado é importado automaticamente para o paciente.

## Linhas de acompanhamento

Um mesmo cadastro de paciente pode conter um ou mais acompanhamentos simultâneos:

- Hipertensão;
- Diabetes;
- Gestação;
- Saúde da Criança.

Os dados específicos ficam no mapa `dados`, separados por programa, enquanto identificação, posto, risco geral e próximo retorno permanecem centralizados no documento do paciente.

## Estrutura do Firestore

### `postos/{postoId}`

Campos principais:

- `nome`: string;
- `sigla`: string;
- `cnes`: string;
- `ativo`: boolean;
- `criadoEm`: timestamp;
- `atualizadoEm`: timestamp.

A enfermeira responsável é determinada pelo perfil ativo em `usuarios` que possui `role = posto` e o `postoId` da unidade. O sistema impede, pela interface administrativa, duas enfermeiras responsáveis ativas no mesmo posto.

### `usuarios/{uid}`

Campos principais:

- `nome`: string;
- `email`: string;
- `role`: `admin` ou `posto`;
- `cargo`: `administrador` ou `enfermeira_responsavel`;
- `postoId`: ID do posto para a enfermeira responsável; `null` para administrador;
- `ativo`: boolean;
- `criadoEm`: timestamp;
- `atualizadoEm`: timestamp.

`role` representa o escopo de permissão. O valor técnico `posto` significa que a conta opera somente dentro de uma unidade. `cargo` representa a função de negócio da conta, atualmente a enfermeira responsável.

O ID do documento deve ser o mesmo UID do usuário no Firebase Authentication.

### `pacientes/{id}`

Contém identificação central, `postoId`, `programas[]`, mapa `dados`, `riscoGeral`, `proximoRetorno`, `acsResumo`, indicador de pendências e status `ativo`.

### `historico/{id}`

Registro de auditoria com paciente, posto, ação, resumo, usuário e data. Depois de criado, o histórico não pode ser editado nem apagado pelo cliente.

## Primeiro administrador

O primeiro administrador precisa ser criado manualmente porque ainda não existe um administrador autenticado para cadastrar os demais.

1. No Firebase Console, abra **Authentication > Sign-in method** e habilite **E-mail/senha**.
2. Em **Authentication > Users**, crie a conta do primeiro administrador.
3. Copie o **UID** dessa conta.
4. Abra **Firestore Database** e crie a coleção `usuarios`.
5. Crie um documento cujo **Document ID seja exatamente o UID** copiado.
6. Adicione:

```text
nome      (string)  = Nome do administrador
email     (string)  = Mesmo e-mail do Authentication
role      (string)  = admin
postoId   (null)    = null
ativo     (boolean) = true
```

`criadoEm`, `atualizadoEm` e `cargo` são opcionais no primeiro registro manual.

7. Em **Firestore Database > Rules**, publique o conteúdo de `firestore.rules`. O arquivo `firestore-rules.txt` contém a mesma versão para facilitar copiar e colar.
8. Entre no EXRisco com o administrador.
9. Cadastre os postos de saúde.
10. Depois disso, use a tela **Usuários** do próprio EXRisco para criar a enfermeira responsável de cada posto.

## Enfermeira responsável

Cada posto deve ter uma enfermeira responsável ativa. A conta é tecnicamente um perfil de escopo `posto`, mas a interface apresenta a função como **Enfermeira responsável**.

A enfermeira pode:

- visualizar os pacientes da própria unidade;
- cadastrar novos pacientes diretamente no próprio posto;
- editar os dados de vigilância desses pacientes;
- arquivar e reativar pacientes;
- consultar o histórico dos pacientes da unidade;
- usar a calculadora auxiliar de risco.

A enfermeira não pode visualizar, cadastrar ou mover pacientes para outro posto. O administrador geral continua com acesso a todas as unidades.

## Segurança

- Administrador geral pode acessar todas as unidades.
- Enfermeira responsável só pode acessar pacientes e históricos do próprio `postoId`.
- Posto inativo bloqueia o acesso operacional da enfermeira vinculada a ele.
- Usuário desativado consegue apenas ter seu próprio perfil identificado para receber a mensagem de bloqueio.
- A enfermeira não pode mover um paciente para outra unidade.
- Campos de autoria/criação do paciente não podem ser alterados depois do cadastro.
- O próprio administrador conectado não pode se desativar nem remover seu papel administrativo pelas regras do cliente.
- Pacientes não podem ser excluídos pelo cliente; somente arquivados.
- Histórico não pode ser editado nem apagado.
- A configuração web do Firebase é pública por natureza; a proteção dos dados está na autenticação e nas regras do Firestore.

## Arquivos principais

```text
index.html
styles.css
styles-base.css
styles-ui.css
app.js
app-config.js
app-patient.js
app-admin.js
app-main.js
sw.js
manifest.webmanifest
firestore.rules
firestore-rules.txt
firebase.json
.firebaserc
.github/workflows/static-check.yml
```

## Publicação

### Firebase Hosting

O projeto já contém `.firebaserc` apontando para `extratificacao` e `firebase.json`.

```bash
npm install -g firebase-tools
firebase login
firebase deploy
```

### GitHub Pages

O sistema também funciona como site estático pela branch `main`. Como o Firebase Authentication e o Firestore são externos, a mesma interface pode ser servida pelo GitHub Pages sem backend próprio no GitHub.

## Validação automática

O workflow **EXRisco Static Check** verifica a cada alteração no `main`:

- presença dos arquivos obrigatórios;
- sintaxe dos módulos JavaScript;
- sincronização entre `firestore.rules` e `firestore-rules.txt`;
- referências de CSS, JavaScript e arquivos do cache PWA.

## Versão

`1.0.2` — estrutura de enfermeira responsável por posto e atualização do PWA.
