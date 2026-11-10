# Roteiro: da ferramenta ao `roteiro.json`

## Índice
1. Descobrir o que ensinar
2. Desenhar a série
3. Entrevista (perguntas prontas)
4. Escrever o texto da tela
5. Schemas (`serie.json`, `roteiro.json`)
6. Exemplo completo
7. Apresentar para aprovação

---

## 1. Descobrir o que ensinar

O objetivo é um **mapa de tarefas do usuário final**: o que a pessoa consegue *fazer* com a ferramenta, e não como o código está organizado.

**Projeto local**
- README, `docs/`, changelog: features declaradas e a linguagem que o produto usa.
- Rotas e páginas (`app/`, `pages/`, `routes`, `urls.py`, router do front): cada tela é candidata a vídeo.
- Menu de navegação, sidebar e header: a ordem em que o usuário descobre as coisas.
- Formulários e modais: as tarefas que mudam dados (são as que mais geram dúvida).
- Onboarding, empty states e tooltips: o que o time já achou que precisava explicar.
- Feature flags e permissões: o que *não* aparece para todo mundo (não prometa no vídeo).

**URL ao vivo**
- `read_page` com `filter: "interactive"` nas telas principais. Abra os menus e liste as ações.
- Não clique em nada destrutivo para explorar.

Formato do mapa (rascunho para você, não precisa mostrar inteiro):

| Tarefa | Tela inicial | Passos aprox. | Depende de |
|---|---|---|---|
| Publicar uma vaga | /vagas | 4 | ter conta |
| Convidar um colega | /config/equipe | 3 | ser admin |

## 2. Desenhar a série

- **Um vídeo = um resultado.** O título responde "Como eu…?": "Como publicar sua primeira vaga". Vídeos com dois resultados viram dois vídeos.
- **Duração**: 30 s a 3 min depois da edição. Isso dá 3 a 8 passos. Acima de 8 passos, divida.
- **Ordem**: primeiro o fluxo principal (o "aha" do produto), depois as variações, depois a configuração ou o que é avançado. Cada vídeo assume só o que os anteriores ensinaram.
- **Quantidade típica**: 3 a 8 vídeos para uma ferramenta pequena ou média. Proponha um número e justifique em uma frase.
- **Pré-condições explícitas**: se o vídeo 3 precisa de uma vaga criada, isso vai em `pre_condicoes` e você prepara antes de gravar.

## 3. Entrevista (perguntas prontas)

Use AskUserQuestion com no máximo 4 perguntas por chamada. Coloque a sua recomendação como primeira opção, com "(Recomendado)". Cada pergunta deve ser compreensível sozinha (cite o produto ou a tarefa no texto).

1. **Público**: "Quem vai assistir aos tutoriais do <produto>?" Opções: usuários novos sem experiência, usuários que já usam e querem ir além, time interno (suporte/vendas), clientes avaliando a compra.
2. **Objetivo**: onboarding, reduzir chamados de suporte, demo comercial, documentação interna.
3. **Conteúdo** (multiSelect): as 4 tarefas mais importantes do mapa. Se houver mais, faça uma segunda rodada.
4. **Quantidade e duração**: a sua proposta ("5 vídeos de ~1 min") contra alternativas (menos e mais longos, mais e mais curtos).
5. **Visual**: preset `aurora` (escuro, roxo), `grafite` (escuro, verde), `claro`. Pergunte a cor da marca (hex) e o caminho do logo (PNG/SVG) se houver.
6. **Ambiente**: qual URL usar (produção ou staging), se já existe uma conta demo logada no Chrome e se pode criar e apagar dados durante a gravação.
7. **Limites**: o que nunca pode aparecer (clientes reais, valores, e-mails), tarefas fora do escopo.
8. **Áudio** (opcional): sem som, música de fundo (o usuário fornece o arquivo) ou só cliques sutis.

Não pergunte o que você consegue descobrir sozinho (as telas, o nome dos botões, quantos passos tem um fluxo).

## 4. Escrever o texto da tela

O vídeo não tem narração. O texto na tela é a voz. Ele aparece numa faixa abaixo da janela, com o número do passo.

- **`titulo`** (até ~45 caracteres): imperativo, uma ação, nomeando o elemento como está na tela. "Clique em Nova vaga", "Escolha o modelo de trabalho". Evite "Agora vamos…" e "Neste passo…".
- **`texto`** (opcional, até ~90 caracteres): onde fica ou por que fazer. "Fica no canto superior direito da lista." "Assim os candidatos filtram por remoto."
- **`dica`** (opcional, até ~100 caracteres): atalho, boa prática ou armadilha. Aparece depois de 1 s, com um ícone de lâmpada.
- **Verbos consistentes** em toda a série: Clique, Digite, Escolha, Arraste, Confira.
- **Nomes exatos da interface**, com a mesma capitalização. Não use aspas nem negrito: o callout é que aponta.
- **Callouts** (`__tut.callout` na gravação): no máximo 1 ou 2 por passo, com rótulo de até ~5 palavras. Use para *onde olhar*: o botão que não é óbvio, o resultado que apareceu.
- **Tempo de leitura**: o editor garante ~190 palavras por minuto mais 1,2 s. Texto demais = passo longo e parado. Corte palavras antes de aceitar isso.
- **`aprendizados`** (capa do vídeo): 2 ou 3 itens, cada um com até ~6 palavras, começando por verbo no infinitivo.
- **Idioma**: o de `serie.json` (`idioma`, padrão `pt-BR`). Rótulos fixos (Passo, Dica, Recapitulando) acompanham `pt`, `en` e `es`.

## 5. Schemas

Os arquivos são validados por `$TUT validate SERIE`. O erro diz o campo exato.

### `SERIE/serie.json`

```json
{
  "produto": "Radar",
  "titulo_serie": "Primeiros passos no Radar",
  "publico": "recrutadores que nunca usaram o painel",
  "idioma": "pt-BR",
  "viewport": { "largura": 1280, "altura": 720 },
  "tema": {
    "preset": "aurora",
    "cor_destaque": "#7c3aed",
    "logo": "assets/logo.png",
    "janela": true,
    "zoom_max": 1.8,
    "fps": 30,
    "intro": true,
    "outro": true
  },
  "audio": { "musica": "assets/musica.mp3", "volume_musica": 0.12, "cliques": false },
  "videos": ["01-publicar-vaga", "02-editar-vaga"]
}
```

- `viewport`: o tamanho da página durante a gravação. 1280x720 deixa o texto da interface legível no vídeo. Use 1440x810 só para telas muito densas. Precisa caber na tela do Mac junto com a barra do Chrome (o `windowPlan` avisa se não couber).
- `logo` e `musica`: caminhos **relativos à pasta da série** (copie os arquivos para `SERIE/assets/`).
- `janela`: barra estilo macOS com a URL (host + caminho, nunca query string).
- `fps`: 30 é o padrão. 60 deixa o cursor e o zoom mais suaves, mas dobra o tempo de render.

### `SERIE/videos/<NN-slug>/roteiro.json`

```json
{
  "id": "01-publicar-vaga",
  "titulo": "Como publicar sua primeira vaga",
  "subtitulo": "Do painel à vaga no ar em menos de um minuto",
  "aprendizados": ["Encontrar a área de vagas", "Preencher o essencial", "Publicar e conferir"],
  "url_inicial": "https://app.radar.dev/painel",
  "pre_condicoes": ["conta demo logada", "nenhuma vaga chamada 'Desenvolvedora Front-end Pleno'"],
  "passos": [
    {
      "id": "abrir-vagas",
      "titulo": "Abra a área de Vagas",
      "texto": "Fica no menu lateral, à esquerda.",
      "acoes": ["clicar em 'Vagas' no menu lateral", "callout no botão '+ Nova vaga': 'Comece por aqui'"],
      "resultado_esperado": "lista de vagas visível"
    },
    {
      "id": "preencher",
      "titulo": "Preencha os dados da vaga",
      "texto": "Clique em Nova vaga e dê um título claro.",
      "dica": "Títulos com senioridade atraem candidatos mais certeiros.",
      "acoes": ["clicar em '+ Nova vaga'", "clicar no campo Título", "__tut.type('Desenvolvedora Front-end Pleno')"],
      "resultado_esperado": "formulário preenchido"
    },
    {
      "id": "buscar",
      "titulo": "Ache qualquer coisa com ⌘K",
      "acoes": ["apertar cmd+k", "esperar 2 s", "apertar Escape"],
      "zoom": "off"
    }
  ]
}
```

- `id` do vídeo: `NN-slug` (define a ordem e o nome do MP4). `id` do passo: kebab-case, usado nas marcas `start:`/`end:`.
- `acoes`: instruções para você mesmo na hora de gravar. Seja específico (texto do botão, valor a digitar, callouts planejados).
- `zoom: "off"`: para passos em que a tela inteira importa (um modal central, um dashboard).
- Limites: até 12 passos por vídeo e até 4 aprendizados.

## 6. Exemplo de plano de série (para mostrar ao usuário)

| # | Vídeo | Resultado para quem assiste | Passos | Duração |
|---|---|---|---|---|
| 1 | Como publicar sua primeira vaga | vaga no ar | 4 | ~45 s |
| 2 | Como acompanhar candidatos | saber quem se candidatou | 5 | ~1 min |
| 3 | Como convidar seu time | colegas com acesso | 3 | ~40 s |

## 7. Apresentar o roteiro para aprovação

Mostre cada vídeo assim (não mostre o JSON, a não ser que o usuário peça):

**01 · Como publicar sua primeira vaga** (~45 s): *Do painel à vaga no ar*
| Passo | Na tela | O que acontece |
|---|---|---|
| 1 | **Abra a área de Vagas**: Fica no menu lateral | clique em Vagas; destaque "+ Nova vaga" |
| 2 | **Preencha os dados da vaga** (dica: senioridade no título) | Nova vaga → digita o título |

Pergunte: "Aprovado? Quer mudar algum texto, ordem ou passo?" Só grave depois do OK.
