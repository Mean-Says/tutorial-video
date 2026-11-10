# tutorial-video

Skill do Claude Code que cria séries de vídeos tutoriais em MP4 (16:9, estilo Screen Studio) ensinando a usar qualquer ferramenta web.

O Claude estuda o projeto e te entrevista sobre público, objetivo e quantidade de vídeos. Depois escreve o roteiro e opera a ferramenta no seu Chrome pela extensão Claude in Chrome enquanto grava a tela. No fim, edita no Remotion, com zoom nos cliques, cursor animado, legendas por passo e callouts.

## Requisitos

- macOS (a captura usa `ffmpeg` com avfoundation e AppleScript para posicionar a janela)
- `ffmpeg`, Node 22+ e Google Chrome
- Extensão Claude in Chrome conectada (`/chrome`)
- Permissão de Gravação de Tela para o terminal

## Instalação

```bash
git clone https://github.com/Mean-Says/tutorial-video ~/.claude/skills/tutorial-video
~/.claude/skills/tutorial-video/scripts/tut doctor   # instala as dependências do engine no primeiro uso
```

Depois é só pedir ao Claude algo como "faz uns vídeos ensinando a usar o meu painel".

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `SKILL.md` | Fluxo completo (entrevista → roteiro → ensaio → gravação → edição → entrega) |
| `references/` | Guias de roteiro, gravação e edição |
| `assets/recorder.js` | Script injetado na página que registra cliques, teclas e navegação (nunca o texto digitado) |
| `scripts/` | `tut` (CLI do engine), `rec.sh` (gravação de tela), `chrome-window.sh` |
| `engine/` | Pipeline em TypeScript: sincronia, cortes, câmera, cursor e composição Remotion |

Testes: `cd engine && npm test`.

## Privacidade

A skill grava a sua tela e o seu Chrome com as suas sessões. Use contas de demonstração e dados fictícios. A skill não digita senhas, recorta a gravação só na área da página e remove query strings das URLs exibidas.

## Licença do Remotion

O Remotion é gratuito para pessoas físicas e empresas com até 3 funcionários. Empresas maiores precisam de licença: [remotion.dev/docs/license](https://www.remotion.dev/docs/license).
