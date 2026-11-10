---
name: tutorial-video
description: Cria séries de vídeos tutoriais em MP4 (16:9, estilo Screen Studio, com zoom nos cliques, cursor animado, legenda por passo e callouts) ensinando a usar qualquer ferramenta web. O Claude entende o projeto, entrevista o usuário sobre direção, público e quantidade de vídeos, escreve o roteiro e o texto da tela, opera a ferramenta no Chrome real pela extensão Claude in Chrome enquanto grava a tela, e edita e renderiza no Remotion. Entrega uma pasta com os MP4. Use sempre que o usuário quiser vídeo tutorial, onboarding em vídeo, walkthrough, screencast, demo gravada, vídeo de treinamento ou curso mostrando como usar um app, site, SaaS, painel ou ferramenta interna, mesmo sem dizer "tutorial" (ex.: "grava uns vídeos mostrando como usa o painel", "faz um vídeo ensinando o cadastro", "quero vídeos de ajuda pro meu sistema"). Não use para vídeo de marketing só com animação (sem gravar tela real) nem para editar um vídeo que o usuário já gravou.
---

# Tutorial Video

Transforma "ensina as pessoas a usar isso" em uma pasta de MP4 prontos. O Claude é diretor, roteirista, operador e editor. O usuário só aprova o plano, aprova o roteiro e assiste o resultado.

## Como funciona (e por que assim)

```
entender a ferramenta → entrevista → roteiro (aprovação) → ensaio sem gravar
   → calibrar a tela → gravar cada vídeo → tut prepare → tut plan/stills → tut render → entrega/
```

Três problemas definem a arquitetura. Entenda-os, porque eles explicam quase todas as regras abaixo:

1. **Os cliques da extensão não movem o mouse do sistema.** A gravação de tela sai sem cursor. Por isso um `recorder.js` injetado na página registra onde e quando cada clique, tecla e navegação aconteceu, e o cursor, a onda do clique, o zoom e os callouts são desenhados depois, na edição. Como a edição conhece o futuro, o cursor desliza até o botão *antes* do clique, e a câmera dá zoom antes da ação.
2. **Sincronizar vídeo e eventos.** No início e no fim de cada take, `__tut.flash()` pinta a página de magenta por meio segundo. O editor acha esse flash no vídeo e com ele descobre o tempo exato (relógio da página → tempo do vídeo) e o retângulo exato da página na tela, sem calcular coordenadas de Retina ou de vários monitores.
3. **O Claude é lento entre uma ação e outra.** O vídeo bruto tem longos trechos parados. O editor corta esses trechos (frames idênticos, então o corte não aparece), acelera esperas com movimento e congela o resultado final o tempo necessário para ler a legenda. Então não tenha pressa durante a gravação. Pressa só gera erro.

Caminhos usados abaixo:
- `SKILL_DIR`: a pasta desta skill (onde está este arquivo).
- `TUT="$SKILL_DIR/scripts/tut"`, `REC="$SKILL_DIR/scripts/rec.sh"`, `WIN="$SKILL_DIR/scripts/chrome-window.sh"`.
- `SERIE`: a pasta da série, por padrão `./tutoriais/<slug-da-serie>/` no diretório atual (pergunte se o usuário preferir outro lugar).

Todo comando `tut` imprime uma linha `RESULT {json}` no final. Leia essa linha para decidir o próximo passo.

## Fase 0: Pré-requisitos (uma vez por sessão)

1. Rode `$TUT doctor`. Na primeira vez ele instala o motor (Remotion) e, no primeiro render, baixa um Chrome headless (~140 MB).
2. Carregue as ferramentas do Claude in Chrome numa única chamada de ToolSearch: `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__find,mcp__claude-in-chrome__read_page`. Se a extensão não estiver conectada, peça ao usuário para rodar `/chrome`. Sem ela não há gravação.
3. Avise o usuário, uma vez, do que vai acontecer na máquina dele: o macOS vai pedir permissão de **Gravação de Tela** para o app do terminal e de **Automação** do Chrome (para posicionar a janela). Durante as gravações ele deve ligar o **Não Perturbe** e não mexer no mouse nem nas janelas.

## Fase 1: Entender a ferramenta

Antes de perguntar qualquer coisa, estude o que vai ser ensinado. Perguntas boas dependem disso.

- **Se há um projeto local** (repositório): leia o README e a documentação, as rotas e páginas, o menu de navegação, os formulários e o onboarding. Liste as funcionalidades do ponto de vista do usuário final ("criar vaga", "convidar colega"), não do código.
- **Se é uma URL**: navegue com o Claude in Chrome, use `read_page` com `filter: "interactive"` nas telas principais e abra os menus.

Resultado: um mapa curto de tarefas que o público consegue realizar, com a tela de início de cada uma. Detalhes em `references/roteiro.md`.

## Fase 2: Entrevista e plano da série

Use AskUserQuestion. Cada pergunta deve trazer opções concretas tiradas do mapa da Fase 1 e uma recomendação. O usuário não deve ter que inventar a resposta. Decida junto com ele:

- **Público e nível** (quem assiste, o que já sabe).
- **Objetivo da série** (onboarding, reduzir suporte, demo de vendas, treinamento interno).
- **O que ensinar**: multiselect com as tarefas do mapa.
- **Quantos vídeos**. Proponha você: um vídeo = um resultado ("Como publicar uma vaga"), de 30 s a 3 min, de 3 a 8 passos.
- **Visual**: preset `aurora` (escuro), `grafite` ou `claro`, cor da marca e logo.
- **Ambiente de gravação**: URL, conta de demonstração já logada no Chrome, dados fictícios, o que nunca pode aparecer.

Depois mostre o plano da série (tabela: nº, título, resultado, duração estimada) e espere o OK.

## Fase 3: Roteiro (gate de aprovação)

Escreva `SERIE/serie.json` e um `SERIE/videos/<NN-slug>/roteiro.json` por vídeo, seguindo os schemas e as regras de texto de `references/roteiro.md`. Os pontos que mais importam:

- Cada passo tem um `titulo` imperativo e curto (o que aparece grande na tela), um `texto` opcional (onde ou por quê), as `acoes` (para você executar) e um `resultado_esperado`.
- Escreva os nomes da interface exatamente como aparecem na tela. Quem assiste procura aquele texto.

Rode `$TUT validate SERIE` e mostre ao usuário uma tabela legível de cada roteiro. **Não grave nada antes do OK.** Regravar custa muito mais que reescrever.

## Fase 4: Ensaio (sem gravar)

Para cada vídeo, execute os passos no Chrome sem gravar. Assim você descobre os seletores e as refs que funcionam, popups inesperados, carregamentos lentos e o que precisa estar pronto antes (dados, login). Depois:

- Volte o sistema ao estado inicial (apague o que criou no ensaio, se o usuário concordar).
- Se o login for necessário, peça ao usuário para entrar manualmente. Nunca digite senhas e nunca grave telas de login.
- Ajuste o roteiro se algo não bater (e avise o usuário do que mudou).

## Fase 5: Preparar a janela e calibrar (por série, ou se a janela mudar)

Siga `references/gravacao.md`, seção "Janela e calibração". Em resumo:
1. Injete o `recorder.js`.
2. Rode `__tut.windowPlan(1280, 720)`. Com o marker e os bounds que ele devolver, rode `$WIN <marker> <bounds...>`.
3. Grave alguns segundos em tela cheia com um flash: `$REC start SERIE/.tut/calibracao --full` → `__tut.flash()` → `$REC stop ...`.
4. Rode `$TUT calibrate SERIE` e **olhe** o `viewport.png` gerado.

Ele precisa mostrar só a página, sem barra do navegador, sem outras janelas e sem bordas ou avisos da extensão. Se aparecer borda, configure `insets` em `captura.json`.

## Fase 6: Gravar cada vídeo

Protocolo completo em `references/gravacao.md`. O esqueleto de uma take:

```
$REC start SERIE/videos/<id>/take-1          # grava só a área da página (recorte da calibração)
javascript_tool: __tut.flash()                # flash inicial (sincronia)
para cada passo:
  javascript_tool: __tut.mark('start:<passo>')
  execute as ações (computer: left_click / hover / key; digitação com __tut.type)
  destaque o que importa: __tut.callout('texto ou seletor', 'rótulo curto')
  espere o resultado aparecer na tela
  javascript_tool: __tut.mark('end:<passo>')
javascript_tool: __tut.flash()                # flash final (corrige deriva do relógio)
javascript_tool: __tut.dump()  →  $TUT save-events SERIE/videos/<id>/take-1   (JSON via stdin)
$REC stop SERIE/videos/<id>/take-1
$TUT prepare SERIE/videos/<id>/take-1
```

Regras que evitam regravações:
- **Depois de qualquer carregamento completo de página, reinjete o recorder.** Os eventos anteriores ficam guardados na sessão da aba. Antes de sair para outro domínio, faça `dump` e `save-events`.
- **Se um passo der errado no meio**, use `__tut.mark('abort:<passo>')`, volte ao estado anterior e recomece com `start:<passo>`. Vale a última tentativa completa. Não pare a gravação por isso.
- **Para digitar, prefira `__tut.type('texto')`** depois de clicar no campo (o texto aparece letra a letra). O `computer type` faz o texto surgir de uma vez.
- **Para rolar, prefira `__tut.scrollTo('texto ou seletor')`** (rolagem suave). Pausas são grátis, porque o editor corta. Não tenha pressa.
- **Não dispare `alert` / `confirm`**: eles travam a extensão. Se um passo exige "Excluir", avise o usuário antes.

## Fase 7: Editar e revisar

```
$TUT prepare SERIE/videos/<id>/take-N    # recorta, sincroniza, mede movimento → take.json
$TUT stills  SERIE <id>                  # plano + grade de stills em videos/<id>/qc/stills.jpg
```

**Olhe a grade de stills** (Read na imagem) antes de renderizar. Confira:
- o cursor e as ondas de clique caem sobre o elemento certo;
- os callouts envolvem o elemento;
- a legenda bate com o que está na tela;
- o zoom não está em área vazia;
- não aparece dado sensível.

Corrija o roteiro (texto) ou regrave só o passo problemático numa `take-2`. O plano usa a take mais nova que tem o passo completo. Então:

```
$TUT render SERIE <id>                   # → SERIE/entrega/<id>.mp4 + capítulos + contact sheet
```

Abra o contact sheet (`entrega/<id>.sheet.jpg`) para uma última conferida. Ajustes visuais (tema, zoom, música, intro e outro) estão em `references/edicao.md`.

## Fase 8: Entrega

1. Rode `$TUT deliver SERIE`. Ele gera `entrega/LEIAME.md` com títulos, durações e capítulos prontos para colar no YouTube.
2. Mostre ao usuário a pasta `entrega/` e um resumo (vídeos, durações, o que foi coberto).
3. Se puder enviar arquivos, mande o primeiro MP4.
4. Pergunte antes de rodar `$TUT clean SERIE`, que apaga as gravações brutas `raw.mkv` e libera espaço.

## Princípios

- **O roteiro manda; a gravação obedece.** Se a interface real divergir do roteiro, pare e ajuste o roteiro com o usuário. Não improvise na gravação.
- **Um passo = uma ideia na tela.** Se a legenda precisa de duas frases, provavelmente são dois passos.
- **Mostre, não conte.** Use o callout para apontar o elemento. A legenda só nomeia a ação.
- **Privacidade por padrão.** Grave só a área da página, use uma conta de demonstração com dados fictícios e não mostre query strings na barra. Antes de gravar, feche o que não deve aparecer.
- **Verifique o resultado com os olhos.** Stills e contact sheet existem para você olhar. Não diga ao usuário que o vídeo está bom sem ter olhado.

## Referências

- `references/roteiro.md`: descoberta da ferramenta, desenho da série, perguntas da entrevista, schemas de `serie.json` e `roteiro.json`, regras de texto, exemplos.
- `references/gravacao.md`: janela, calibração, take passo a passo, API do `__tut`, recuperação de erros e armadilhas do Claude in Chrome e do macOS.
- `references/edicao.md`: como o editor decide cortes, zoom e cursor, opções de tema e áudio, checklist de QC e solução de problemas.
