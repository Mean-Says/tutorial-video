# Gravação: protocolo com Claude in Chrome + macOS

## Índice
1. Antes de começar
2. Abrir a aba e injetar o recorder
3. Janela e calibração
4. Gravar uma take (passo a passo)
5. API do `__tut`
6. Quando algo dá errado
7. Armadilhas conhecidas

---

## 1. Antes de começar

- O roteiro está aprovado e o ensaio (Fase 4) passou. Os dados de demonstração estão prontos e o estado inicial está restaurado.
- Peça ao usuário: Não Perturbe ligado, não mexer no mouse, no teclado nem nas janelas durante as takes, e deixar o Chrome na tela principal (a "Capture screen 0"; outro monitor: `TUT_SCREEN=1`).
- A janela do Chrome não pode estar em tela cheia (Full Screen do macOS), senão não dá para posicionar.
- Zoom da página em 100% (⌘0). O `viewport` do `serie.json` já controla o tamanho do texto no vídeo.

## 2. Abrir a aba e injetar o recorder

1. `tabs_context_mcp`, depois `tabs_create_mcp` e `navigate` para a `url_inicial`.
2. Leia `SKILL_DIR/assets/recorder.js` (Read) e passe o arquivo **inteiro** como `text` de `javascript_tool`. A resposta esperada é `tut:ok`.
3. Faça uma ação inofensiva com a extensão (um `screenshot`). Assim qualquer barra de "depuração" do Chrome já aparece agora, e não no meio da take, onde mudaria o tamanho da página.

O recorder é idempotente: injetar de novo na mesma página não duplica nada. Ele precisa ser reinjetado **depois de cada carregamento completo de página** (navegação, submit que recarrega, link para outra página). Navegação de SPA (pushState) não perde o recorder. Para checar: `javascript_tool` com `typeof __tut`. Se der `'undefined'`, injete de novo.

## 3. Janela e calibração

Faça uma vez por série, e de novo se a janela mudar de lugar ou de tamanho.

```
javascript_tool:  JSON.stringify(__tut.windowPlan(1280, 720))      # use o viewport do serie.json
                  → {"marker":"TUTab12cd","bounds":[l,t,r,b]}  (ou {"error":"não cabe na tela","max":{...}})
bash:             $WIN TUTab12cd l t r b                          # traz a aba para frente e dimensiona a janela
javascript_tool:  __tut.untitle(); JSON.stringify(__tut.info())  # confira iw/ih == viewport e visible == "visible"
```

Se `iw`/`ih` estiverem alguns pixels diferentes (a barra do Chrome mudou de altura), rode `windowPlan` e `$WIN` de novo. Se não couber, use o `max` sugerido, ou 1280x720 numa tela pequena.

Depois, calibre:

```
bash:             $REC start SERIE/.tut/calibracao --full
javascript_tool:  __tut.flash()
bash:             $REC stop SERIE/.tut/calibracao       # espere ~1 s depois do flash
bash:             $TUT calibrate SERIE
Read:             SERIE/.tut/calibracao/viewport.png
```

O `viewport.png` deve mostrar **só a página**: sem abas, sem barra de endereço, sem outras janelas, sem a borda ou os avisos da extensão.
- **Borda ou faixa da extensão** dentro da área: adicione `insets` (px na resolução física) em `SERIE/captura.json`, por exemplo `"insets": {"top": 0, "right": 6, "bottom": 6, "left": 6}`. Isso é aplicado no `prepare`.
- **Imagem errada** (outra janela ou área): a aba não estava na frente ou estava em outro monitor. Repita o passo da janela.
- **Erro "Nenhum flash magenta"**: falta a permissão de Gravação de Tela para o app do terminal (Ajustes do Sistema → Privacidade e Segurança → Gravação de Tela; reinicie o terminal depois), ou a janela estava coberta.

A calibração grava `SERIE/captura.crop`. A partir daí `$REC start` grava **só a área da página** (mais uma margem de 8 px), e o arquivo bruto não contém o resto da sua tela.

## 4. Gravar uma take

Uma take = uma gravação contínua, normalmente um vídeo inteiro. Pasta: `SERIE/videos/<id>/take-1` (a próxima é `take-2`, e assim por diante).

```
bash:  $REC start SERIE/videos/<id>/take-1
js:    __tut.dump()                      # descarta eventos do ensaio que ainda estejam no buffer
js:    __tut.flash()
```

Para cada passo do roteiro:

```
js:    __tut.mark('start:<passo>')
       … ações …
js:    __tut.mark('end:<passo>')
```

Como executar as ações, para que o vídeo fique bom:
- **Cliques**: `computer` com `left_click`, por `ref` (de `find`/`read_page`) ou coordenada. O recorder registra o ponto e o retângulo do elemento, e é isso que guia o cursor e o zoom.
- **Hover** (menus que abrem ao passar o mouse): `computer` com `hover`.
- **Digitar**: clique no campo e rode `__tut.type('texto')` (~14 caracteres/s, aparece letra a letra). Para textos longos, `__tut.type('...', 30)`. O `computer type` também funciona, mas o texto surge de uma vez.
- **Teclas e atalhos**: `computer` com `key` (`Enter`, `cmd+k`). Atalhos e teclas especiais aparecem no vídeo como teclas desenhadas. Letras comuns nunca são registradas.
- **Rolar**: `__tut.scrollTo('texto visível ou seletor')` (suave). O `computer scroll` dá saltos.
- **Destacar**: `__tut.callout('texto visível ou seletor', 'Rótulo curto', segundos?)`. Ele desenha uma caixa com rótulo sobre o elemento na edição (nada aparece na página). Chame quando o elemento já estiver visível e parado.
- **Esperar o resultado**: depois de uma ação que carrega algo, espere aparecer (`computer` `wait` 1–2 s ou um screenshot) antes do `end:`. O editor mostra o resultado assentado por ~1,4 s.
- **Não tenha pressa.** O tempo que você leva pensando entre as ações é cortado na edição.

Ao terminar o último passo:

```
js:    __tut.flash()
js:    __tut.dump()                      # devolve uma string JSON
bash:  $TUT save-events SERIE/videos/<id>/take-1 <<'EOF'
       <cole aqui exatamente o JSON devolvido pelo dump>
       EOF
bash:  $REC stop SERIE/videos/<id>/take-1
bash:  $TUT prepare SERIE/videos/<id>/take-1
```

O `prepare` informa os passos completos e os incompletos e dá avisos (flashes faltando, deriva do relógio, área da página que mudou). Resolva os avisos antes de seguir.

## 5. API do `__tut`

| Chamada | Para quê |
|---|---|
| `__tut.flash(ms=500)` | Flash magenta de sincronia. Obrigatório no início e no fim de cada take. Devolve `flash-failed` se a aba não estiver visível. |
| `__tut.mark('start:<id>' \| 'end:<id>' \| 'abort:<id>')` | Delimita os passos. Vale a última tentativa completa. |
| `__tut.callout(alvo, rótulo, seg?)` | Destaca um elemento (texto visível, seletor CSS ou `{x, y}`). Devolve o retângulo encontrado ou `não achei`. |
| `__tut.type(texto, cps=14)` | Digita no campo focado, letra a letra (funciona com React). |
| `__tut.scrollTo(alvo)` | Rolagem suave até o elemento. |
| `__tut.windowPlan(w, h)` / `__tut.untitle()` | Calcula o tamanho da janela e coloca ou tira o marcador no título para o `chrome-window.sh`. |
| `__tut.info()` | Tamanhos da janela, do viewport e da tela, DPR e visibilidade. |
| `__tut.dump()` / `__tut.count()` | Devolve e limpa o buffer de eventos / conta os eventos no buffer. |

Alternativa às marcas pelo navegador: `$TUT mark SERIE/videos/<id>/take-1 start:<passo>` (mesmo relógio). Útil se a página estiver no meio de um carregamento.

## 6. Quando algo dá errado

- **O passo falhou no meio** (clique errado, popup inesperado): `__tut.mark('abort:<passo>')`, desfaça o que precisar, `__tut.mark('start:<passo>')` e repita. Não pare a gravação.
- **A take inteira ficou ruim** (janela mexeu, notificação em cima, dado sensível): pare, apague a pasta da take e grave de novo.
- **Só um passo ficou ruim depois de editar**: grave uma `take-2` só com esse passo (`flash`, `start`, ações, `end`, `flash`). Antes, deixe o sistema no estado em que esse passo começa. O plano pega o passo da take mais nova.
- **Diálogo `alert`/`confirm` travou a extensão**: peça ao usuário para fechá-lo manualmente no Chrome. Depois aborte o passo.
- **A extensão parou de responder**: siga a skill do Claude in Chrome (2 ou 3 tentativas, depois peça ajuda ao usuário). A gravação continua rodando: pare com `$REC stop`.
- **Esqueceu de rodar `$REC stop`**: `$REC status <pasta>` mostra se ainda está gravando.

## 7. Armadilhas conhecidas

- **Aba em segundo plano**: o Claude in Chrome pode abrir abas em grupo ou em outra janela. Se a aba não estiver visível, os cliques podem se perder, os screenshots travam e o flash falha. O `chrome-window.sh` resolve trazendo a aba certa para frente.
- **Barra de depuração do Chrome** (aviso de que uma extensão está depurando o navegador): ela empurra a página para baixo. Faça uma ação antes de calibrar e não feche o aviso no meio da take. O `prepare` avisa se a área mudou entre os flashes.
- **iframes de outro domínio** (checkout embutido, apps embutidos): o recorder não enxerga eventos lá dentro (não haverá cursor nem zoom nesses cliques) e a extensão pode não conseguir clicar. Evite no roteiro ou aceite o passo sem efeitos.
- **Pop-up de permissão do macOS** ("… quer acessar sua tela"): aparece na primeira gravação e às vezes periodicamente. O usuário precisa clicar em Permitir. Se aparecer durante uma take, refaça a take.
- **Sessão expira** durante a série: peça ao usuário para logar de novo (nunca digite senha).
- **Gravação cheia de lixo visual** (toasts de outras features, banners de cookies): feche-os no ensaio. Em muitos sites, carregar a página duas vezes faz os banners de primeira visita sumirem.
- **Dados reais**: se a conta tiver dados de clientes, pare e combine com o usuário um ambiente de demonstração. O vídeo é feito para ser compartilhado.
