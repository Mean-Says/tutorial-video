#!/usr/bin/env bash
# Screen recorder for tutorial-video (macOS, ffmpeg avfoundation).
#   rec.sh start <dir> [--full]   start recording into <dir>/raw.mkv (background)
#   rec.sh stop  <dir>            stop gracefully and report duration
#   rec.sh status <dir>
# By default the capture is cropped live to <serie>/captura.crop (written by `tut calibrate`),
# so the raw file never contains the rest of the desktop. --full records the whole screen (calibration only).
# Env: TUT_SCREEN (avfoundation screen number, default 0), TUT_FPS (30), TUT_BITRATE (16M), TUT_FAKE_INPUT=1 (test pattern, no capture).
set -euo pipefail

cmd="${1:-}"; dir="${2:-}"; shift 2 || true
[ -n "$cmd" ] && [ -n "$dir" ] || { echo "uso: rec.sh start|stop|status <pasta> [--full]" >&2; exit 2; }
mkdir -p "$dir"
dir="$(cd "$dir" && pwd)"
pidf="$dir/rec.pid"; out="$dir/raw.mkv"; log="$dir/rec.log"

running() { [ -f "$pidf" ] && kill -0 "$(cat "$pidf")" 2>/dev/null; }

find_series() {
  local d="$1"
  while [ "$d" != "/" ]; do [ -f "$d/serie.json" ] && { echo "$d"; return 0; }; d="$(dirname "$d")"; done
  return 1
}

case "$cmd" in
  start)
    running && { echo "ERRO: já está gravando (pid $(cat "$pidf"))" >&2; exit 1; }
    full=0; [ "${1:-}" = "--full" ] && full=1
    vf=()
    if [ "$full" = 0 ]; then
      serie="$(find_series "$dir")" || { echo "ERRO: serie.json não encontrado acima de $dir" >&2; exit 1; }
      [ -f "$serie/captura.crop" ] || { echo "ERRO: sem $serie/captura.crop. Rode a calibração antes (veja references/gravacao.md)." >&2; exit 1; }
      vf=(-vf "crop=$(tr -d '[:space:]' < "$serie/captura.crop")")
    fi
    if [ -n "${TUT_FAKE_INPUT:-}" ]; then
      input=(-re -f lavfi -i "testsrc2=size=1600x1000:rate=${TUT_FPS:-30}")
    else
      idx="$(ffmpeg -hide_banner -f avfoundation -list_devices true -i "" 2>&1 | sed -n "s/.*\[\([0-9][0-9]*\)\] Capture screen ${TUT_SCREEN:-0}\$/\1/p" | head -1)"
      [ -n "$idx" ] || { echo "ERRO: 'Capture screen ${TUT_SCREEN:-0}' não encontrada no avfoundation" >&2; exit 1; }
      input=(-f avfoundation -capture_cursor 0 -framerate "${TUT_FPS:-30}" -i "${idx}:none")
    fi
    rm -f "$out"
    nohup ffmpeg -hide_banner -loglevel warning -nostdin -y "${input[@]}" ${vf[@]+"${vf[@]}"} \
      -c:v h264_videotoolbox -b:v "${TUT_BITRATE:-16M}" -pix_fmt yuv420p "$out" > "$log" 2>&1 &
    pid=$!
    echo "$pid" > "$pidf"
    for _ in $(seq 1 60); do [ -s "$out" ] && break; kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$pidf"; echo "ERRO: ffmpeg parou ao iniciar:" >&2; tail -5 "$log" >&2
      echo "Dica: o app do terminal precisa de permissão em Ajustes > Privacidade > Gravação de Tela." >&2; exit 1
    fi
    echo "RESULT {\"ok\":true,\"recording\":true,\"pid\":$pid,\"file\":\"$out\",\"started\":$(date +%s)}"
    ;;
  stop)
    running || { echo "ERRO: nenhuma gravação ativa em $dir" >&2; exit 1; }
    pid="$(cat "$pidf")"
    kill -INT "$pid"
    for _ in $(seq 1 150); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    kill -0 "$pid" 2>/dev/null && { kill -9 "$pid"; echo "AVISO: ffmpeg não fechou sozinho; arquivo pode estar incompleto" >&2; }
    rm -f "$pidf"
    dur="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out" 2>/dev/null || echo 0)"
    size="$(du -m "$out" | cut -f1)"
    echo "RESULT {\"ok\":true,\"file\":\"$out\",\"seconds\":${dur:-0},\"sizeMB\":${size:-0}}"
    ;;
  status)
    if running; then echo "RESULT {\"recording\":true,\"pid\":$(cat "$pidf")}"; else echo "RESULT {\"recording\":false}"; fi
    ;;
  *) echo "comando desconhecido: $cmd" >&2; exit 2 ;;
esac
