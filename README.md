# EXRisco

Sistema PWA para acompanhamento da estratificação de risco e vigilância de pacientes por posto de saúde.

## Linhas de acompanhamento

O cadastro central do paciente pode conter um ou mais acompanhamentos simultâneos:

- Hipertensos
- Diabéticos
- Gestantes
- Saúde da Criança

Os campos foram organizados a partir da planilha de vigilância fornecida. O sistema calcula idade automaticamente, consolida o maior nível de risco do paciente, identifica o próximo retorno e mantém histórico de criação, edição, arquivamento e reativação.

A Calculadora de Estratificação de Riscos do Estado de Goiás aparece como ferramenta auxiliar independente em um modal e também possui fallback para abertura em nova aba. Não existe sincronização automática de dados entre a calculadora externa e o prontuário do EXRisco.

## Estrutura Firestore

### `postos/{postoId}`

- `nome`: string
- `sigla`: string
- `cnes`: string
- `ativo`: boolean
- `criadoEm`: timestamp
- `atualizadoEm`: timestamp

### `usuarios/{uid}`

- `nome`: string
- `email`: string
- `role`: `admin` ou `posto`
- `postoId`: ID do posto para usuários comuns; `null` para administrador
- `ativo`: boolean
- `criadoEm`: timestamp
- `atualizadoEm`: timestamp

### `pacientes/{id}`

Dados centrais do paciente + `programas[]` + mapa `dados` com os campos específicos de cada linha de vigilância. O documento guarda também `riscoGeral`, `proximoRetorno`, `postoId` e status `ativo`.

### `historico/{id}`

Registro de auditoria com paciente, posto, ação, resumo, autor e data. Histórico não pode ser alterado nem apagado pelas regras do cliente.

## Primeiro acesso

1. No Firebase Console, abra **Authentication > Sign-in method** e habilite **E-mail/senha**.
2. Em **Authentication > Users**, crie manualmente o primeiro usuário administrador.
3. Copie o **UID** desse usuário.
4. Abra **Firestore Database** e crie a coleção `usuarios`.
5. Crie um documento cujo **Document ID seja exatamente o UID** copiado.
6. Adicione os campos:

```text
nome      (string)  = Seu nome
email     (string)  = mesmo e-mail criado no Authentication
role      (string)  = admin
postoId   (null)    = null
ativo     (boolean) = true
```

`criadoEm` é opcional para o primeiro registro manual.

7. Em **Firestore Database > Rules**, substitua as regras pelo conteúdo de `firestore.rules` (há também `firestore-rules.txt` para facilitar copiar e colar) e publique.
8. Entre no EXRisco com o primeiro administrador.
9. Cadastre os postos em **Postos de saúde**.
10. Depois disso, o próprio administrador pode criar os demais usuários dentro do sistema e vinculá-los a uma unidade.

## Publicação

### Firebase Hosting

O projeto já contém `.firebaserc` apontando para `extratificacao` e `firebase.json`.

```bash
npm install -g firebase-tools
firebase login
firebase deploy
```

### GitHub Pages

Também funciona como site estático no GitHub Pages. Em **Settings > Pages**, publique a branch `main` pela raiz `/`.

## Segurança

- Administrador: acesso a todos os postos, pacientes, usuários e unidades.
- Usuário de posto: acesso somente aos pacientes cujo `postoId` corresponde ao seu perfil.
- Pacientes são arquivados, não excluídos definitivamente pelo cliente.
- Histórico é somente leitura depois de criado.
- A configuração web do Firebase fica no cliente por natureza; a proteção dos dados depende das regras do Firestore e da autenticação.

## Versão

`1.0.0`
