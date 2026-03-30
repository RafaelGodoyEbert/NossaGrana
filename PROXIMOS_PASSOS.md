# 💜 NossaGrana — Pendências para a Próxima Sessão

Este arquivo serve como memória para retomarmos o desenvolvimento das funcionalidades de **Importação de Extratos** e **Sistema de Parcelamento/Juros**.

## 🛠️ Tecnologias Já Implementadas (Prontas)
- [x] **Parser Base de CSV/OFX** (`js/import-ofx.js`): Suporta Nubank (Conta e Cartão) e OFX padrão.
- [x] **Interface de Parcelamento** (`index.html`): Campos de "Nº Parcelas", "Modo (Total/Mensal)" e "Juros" adicionados ao modal.
- [x] **Lógica de Gravação Múltipla** (`js/main.js`): Função que cria N transações no Firestore baseado no parcelamento.
- [x] **Regex do Chat** (`js/chat/constants.js`): Padrão `10x de 29,90` já é detectado.

## ✅ Concluído nesta sessão

### 1. Motor do Chat (IA Local)
- [x] No arquivo `js/chat/entity-extractor.js`, criada a função `extractInstallment()` que entende que em `10x 29,90`, o "10" é multiplicador e "29,90" é o valor base.
- [x] No arquivo `js/chat/chat-facade.js`, adicionado o tratamento da intenção `ADD_INSTALLMENT` para disparar o processo de gravação múltipla.
- [x] No arquivo `js/chat/chat-ui.js`, adicionado handler de resposta tipo `installment` + callback `onInstallmentCallback`.
- [x] No arquivo `js/main.js`, criada a função `handleChatInstallment()` que cria N transações mensais com `[Parcela X/N]` na descrição e `installmentInfo` nos metadados.

### 2. Estilo e UX
- [x] CSS do painel de parcelas revisado para garantir que o "Modo Dark" preserva o contraste da fonte (regras explícitas em `css/main.css`).
- [x] Adicionado ícone visual 💳 com badge `X/N` na tabela de transações para identificar parcelas (classe `.installment-badge`).

### 3. Validação Real
- [ ] Fazer o primeiro "Import" real usando um arquivo de extrato da pasta `nu_rafa` para validar se as descrições do Nubank estão vindo limpas.

---
**Quando o chat voltar, diga:** *"Validar importação real de extratos Nubank"*
