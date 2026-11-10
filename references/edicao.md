# Edição: como o editor decide, como ajustar, como revisar

## Índice
1. Pipeline de edição
2. Regras automáticas (cortes, câmera, cursor)
3. Opções de visual e áudio
4. Checklist de revisão (QC)
5. Solução de problemas

---

## 1. Pipeline de edição

| Comando | Entrada | Saída |
|---|---|---|
| `$TUT prepare <take>` | `raw.mkv`, `events-*.json`, `marks.jsonl` | `take.mp4` (recortado, 30 fps), `take.json` (eventos no tempo do vídeo, movimento por frame) |
| `$TUT plan SERIE <id>` | `serie.json`, `roteiro.json`, `take-*/take.json` | `plan.json` (tudo resolvido em frames) |
| `$TUT stills SERIE <id>` | plan | `videos/<id>/qc/stills.jpg` (grade com 2 frames por passo) |
| `$TUT render SERIE <id> [--preview]` | plan | `entrega/<id>.mp4`, `.capitulos.txt`, `.sheet.jpg` (`--preview`: meia resolução em `qc/preview.mp4`) |
| `$TUT deliver SERIE` | todos | `entrega/LEIAME.md` |

`stills` e `render` sempre regeneram o plano. Basta editar o roteiro ou o `serie.json` e renderizar de novo, sem regravar. O render leva ~1x a duração do vídeo num Mac M-series.

O vídeo final é 1920x1080 h264 (CRF 18), com:
- capa (título, aprendizados e uma prévia inclinada do resultado final);
- um segmento por passo (janela com a página, legenda com número, "Passo X de Y", barra de progresso);
- encerramento ("Recapitulando", lista de passos, próximo vídeo).

## 2. Regras automáticas

**Cortes** (por passo, entre `start:` e `end:`):
- Mantém 1 s antes da primeira ação (tempo para ler a legenda), 0,8 s antes de cada ação (o cursor desliza) e 1 s depois (1,6 s depois de navegação ou rolagem).
- No fim do passo, espera a tela parar de mudar e mantém mais 1,4 s do resultado.
- Trechos sem ação no meio: se a tela estava parada, corta (os frames são idênticos, então o corte não aparece). Se estava mexendo (carregamento, animação), acelera até 6x quando cabe em ~1 s, senão corta seco.
- Se o passo ficou curto demais para ler o texto (~190 palavras/min + 1,2 s), congela o último frame até completar.

**Câmera** (zoom automático estilo Screen Studio):
- Agrupa ações próximas no espaço e no tempo e dá zoom no grupo (até `zoom_max`, padrão 1,8x). A câmera chega ~0,1 s antes da ação.
- Clique que navega para outra página: zoom mais suave (até 1,4x), que sai ~0,3 s depois da navegação.
- Navegação ou rolagem quebra o grupo e volta para a tela inteira. Cada passo começa e termina na tela inteira.
- Área de ação já grande (formulário inteiro): sem zoom. `"zoom": "off"` no passo desliga.

**Cursor e efeitos**: o cursor desliza com easing de 0,3 a 0,75 s (conforme a distância) e chega 1 frame antes do clique. Também há onda de clique, teclas desenhadas para atalhos (agrupando repetições: "⌫ ×3") e callouts com caixa e rótulo que seguem o zoom e somem antes de uma rolagem.

## 3. Opções de visual e áudio (`serie.json`)

| Campo | Efeito |
|---|---|
| `tema.preset` | `aurora` (escuro/roxo), `grafite` (escuro/verde), `claro` |
| `tema.cor_destaque` | Hex da marca: número do passo, ondas, callouts, barra de progresso |
| `tema.logo` | Logo na capa (relativo à pasta da série) |
| `tema.janela` | Barra estilo macOS com a URL (`false` = só a página com cantos arredondados) |
| `tema.zoom_max` | 1 a 2,5. Use 1,4 para um vídeo mais calmo e 2 para interfaces com texto pequeno |
| `tema.fps` | 30 ou 60 (60 deixa cursor e zoom mais suaves e dobra o tempo de render) |
| `tema.intro` / `tema.outro` | Liga ou desliga a capa e o encerramento |
| `audio.musica` | Arquivo de música (relativo à série). Entra com fade e em volume baixo |
| `audio.volume_musica` | 0 a 1 (padrão 0,12) |
| `audio.cliques` | Som sutil de clique em cada clique |

Ajustes por passo ficam no `roteiro.json` (`zoom`, `texto`, `dica`). Para mudar a lógica (tempos de corte, câmera), os padrões ficam em `engine/src/lib/timeline.ts` (`DEFAULT_EDIT`) e `engine/src/lib/camera.ts` (`DEFAULT_CAMERA`). Rode `npm test` no `engine/` depois de mexer.

Para iterar no visual com preview ao vivo: `cd $SKILL_DIR/engine && npx remotion studio src/remotion/index.ts --public-dir=SERIE`, e cole o conteúdo de `plan.json` como props `{"plan": …}`.

## 4. Checklist de revisão (QC)

Na grade de stills (`qc/stills.jpg`) e no contact sheet do render (`entrega/<id>.sheet.jpg`), olhe de verdade e confira:

- [ ] A janela mostra **só a página**: nada de barra do Chrome, outras janelas ou bordas da extensão.
- [ ] O **cursor e a onda** estão sobre o elemento clicado. Deslocamento constante = recorte errado (recalibre ou ajuste `insets`). Deslocamento que cresce ao longo do vídeo = deriva (faltou o flash final).
- [ ] As **caixas de callout** envolvem o elemento certo e o rótulo não cobre o que importa.
- [ ] A **legenda** de cada passo bate com o que está na tela naquele momento.
- [ ] O **zoom** mostra a ação, e não uma área vazia ou a página antiga depois de uma navegação.
- [ ] **Nenhum dado sensível**: e-mails reais, tokens, nomes de clientes, notificações.
- [ ] Capa e encerramento: títulos não cortados, prévia do resultado coerente.
- [ ] Duração razoável (o `plan` imprime bruto → final por passo). Um passo muito longo geralmente é texto demais ou espera longa com movimento.

Para conferir um momento específico em resolução cheia: `ffmpeg -v error -ss <seg> -i entrega/<id>.mp4 -frames:v 1 /tmp/frame.png` e depois Read.

## 5. Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `Nenhum flash magenta no vídeo` | Faltou permissão de Gravação de Tela, janela coberta ou recorte da calibração errado | `doctor`, recalibrar, regravar |
| `O vídeo tem flash, mas os eventos não` | O `dump` não foi salvo | Rode `__tut.dump()` e `save-events` (se a aba ainda estiver aberta, os eventos ainda estão lá) |
| `Passos sem gravação completa` | Faltam marcas `start:`/`end:` para o id | Confira se os ids batem com o roteiro. Grave uma take-2 só com o que falta |
| `A área da página mudou entre flashes` | A janela mexeu ou a barra de depuração apareceu ou sumiu | Confira os stills. Se o cursor estiver desalinhado, regrave |
| `deriva do relógio alta` | A máquina perdeu frames na captura | Feche apps pesados. Use `TUT_BITRATE=10M` |
| Passo sem cursor nem zoom | O recorder não estava injetado (página recarregou) | Reinjete após cada carregamento e regrave o passo |
| Render falha baixando fonte ou Chrome | Sem internet no primeiro render | Conecte e rode de novo (a fonte Inter vem do Google Fonts) |
| Vídeo borrado no zoom | Viewport grande demais para o recorte ou `zoom_max` alto | Use viewport 1280x720 e `zoom_max` ≤ 1,8 |

**Licença do Remotion**: gratuita para pessoas físicas e empresas com até 3 funcionários. Empresas maiores precisam de licença (remotion.pro). Avise o usuário se for o caso.
