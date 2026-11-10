import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import path from 'node:path';
import { RawEvent, SeriesSpec, Take, VideoSpec, type EditPlan } from './schema.ts';
import { buildPlan } from './lib/plan.ts';
import { calibrate, prepareTake } from './lib/take.ts';
import { contactSheet, run, runOk } from './lib/video.ts';

/**
 * `tut <command>`: every step after the browser work. Each command prints a final
 * `RESULT {json}` line so the calling agent can parse the outcome reliably.
 */

const ENGINE = path.resolve(import.meta.dirname, '..');
const SKILL = path.resolve(ENGINE, '..');
const CALLER_CWD = process.cwd();
const abs = (p: string) => path.resolve(CALLER_CWD, p);
process.chdir(ENGINE);

const result = (data: unknown) => console.log(`RESULT ${JSON.stringify(data)}`);
const fail = (msg: string): never => {
  console.error(`ERRO: ${msg}`);
  result({ ok: false, error: msg });
  process.exit(1);
};

const readJson = (f: string): unknown => JSON.parse(readFileSync(f, 'utf8'));

function loadSeries(serieDir: string): SeriesSpec {
  const f = path.join(serieDir, 'serie.json');
  if (!existsSync(f)) fail(`Não existe ${f}`);
  const parsed = SeriesSpec.safeParse(readJson(f));
  if (!parsed.success) fail(`serie.json inválido:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  return parsed.data!;
}

function loadVideo(serieDir: string, id: string): VideoSpec {
  const f = path.join(serieDir, 'videos', id, 'roteiro.json');
  if (!existsSync(f)) fail(`Não existe ${f}`);
  const parsed = VideoSpec.safeParse(readJson(f));
  if (!parsed.success) fail(`${id}/roteiro.json inválido:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  return parsed.data!;
}

function loadTakes(serieDir: string, id: string): Take[] {
  const dir = path.join(serieDir, 'videos', id);
  const takes = readdirSync(dir)
    .filter((d) => /^take-\d+$/.test(d) && existsSync(path.join(dir, d, 'take.json')))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
    .map((d) => Take.parse(readJson(path.join(dir, d, 'take.json'))));
  if (takes.length === 0) fail(`Nenhuma take preparada em ${dir} (rode: tut prepare ${dir}/take-1)`);
  return takes;
}

function planVideo(serieDir: string, id: string): EditPlan {
  const series = loadSeries(serieDir);
  const video = loadVideo(serieDir, id);
  const takes = loadTakes(serieDir, id);
  const idx = series.videos.indexOf(id);
  const nextId = idx >= 0 ? series.videos[idx + 1] : undefined;
  const next = nextId && existsSync(path.join(serieDir, 'videos', nextId, 'roteiro.json')) ? loadVideo(serieDir, nextId).titulo : undefined;
  const { plan, warnings, stats } = buildPlan(series, video, takes, { next });
  writeFileSync(path.join(serieDir, 'videos', id, 'plan.json'), JSON.stringify(plan, null, 1));
  for (const s of stats) console.log(`  ${s.step.padEnd(24)} take ${s.take}: ${s.rawSeconds}s brutos → ${s.outSeconds}s (cortados ${s.removedSeconds}s)`);
  for (const w of warnings) console.log(`  AVISO: ${w}`);
  console.log(`  Duração final: ${(plan.durationInFrames / plan.fps).toFixed(1)}s`);
  return plan;
}

async function ensureClickSound(serieDir: string): Promise<void> {
  const out = path.join(serieDir, '.tut', 'click.wav');
  if (existsSync(out)) return;
  mkdirSync(path.dirname(out), { recursive: true });
  await runOk('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=1800:duration=0.025', '-af', 'afade=t=out:st=0.005:d=0.02,volume=0.6', out]);
}

async function bundleFor(serieDir: string): Promise<string> {
  const { bundle } = await import('@remotion/bundler');
  return bundle({ entryPoint: path.join(ENGINE, 'src/remotion/index.ts'), publicDir: serieDir, symlinkPublicDir: true });
}

type RenderAttempt = { concurrency: number | null; cacheBytes: number };

async function renderOnce(serveUrl: string, plan: EditPlan, out: string, preview: boolean, attempt: RenderAttempt) {
  const { renderMedia, selectComposition, makeCancelSignal } = await import('@remotion/renderer');
  const inputProps = { plan };
  const composition = await selectComposition({ serveUrl, id: 'Tutorial', inputProps });
  const { cancelSignal, cancel } = makeCancelSignal();
  let lastShown = -1;
  const startedAt = Date.now();
  let lastProgressAt = startedAt;
  let stalled = false;
  // A crashed headless Chrome is restarted by Remotion, but recovery can crawl for minutes:
  // give up on no progress for 90 s or on a total time far beyond normal (~1-2x realtime), then retry leaner.
  const budgetMs = Math.max(5 * 60_000, (plan.durationInFrames / plan.fps) * 6_000);
  const watchdog = setInterval(() => {
    if (Date.now() - lastProgressAt > 90_000 || Date.now() - startedAt > budgetMs) {
      stalled = true;
      cancel();
    }
  }, 5_000);
  try {
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      crf: preview ? 28 : 18,
      scale: preview ? 0.5 : 1,
      outputLocation: out,
      inputProps,
      concurrency: attempt.concurrency,
      offthreadVideoCacheSizeInBytes: attempt.cacheBytes,
      cancelSignal,
      onProgress: ({ progress }) => {
        lastProgressAt = Date.now();
        const pct = Math.floor(progress * 10) * 10;
        if (pct !== lastShown) {
          lastShown = pct;
          console.log(`  render ${pct}%`);
        }
      },
    });
  } catch (e) {
    throw new Error(stalled ? 'render travado (Chrome headless caiu e não se recuperou a tempo)' : e instanceof Error ? e.message : String(e));
  } finally {
    clearInterval(watchdog);
  }
}

async function cmdRender(serieDir: string, id: string, preview: boolean, concurrency: number | null) {
  const plan = planVideo(serieDir, id);
  if (plan.audio.cliques) await ensureClickSound(serieDir);
  const serveUrl = await bundleFor(serieDir);
  const out = preview ? path.join(serieDir, 'videos', id, 'qc', 'preview.mp4') : path.join(serieDir, 'entrega', `${id}.mp4`);
  mkdirSync(path.dirname(out), { recursive: true });
  const started = Date.now();
  // Headless Chrome can crash under memory pressure (big Retina takes + a busy machine): retry leaner.
  const defaultConcurrency = Math.max(1, Math.min(3, Math.floor(cpus().length / 3)));
  const attempts: RenderAttempt[] = [
    { concurrency: concurrency ?? defaultConcurrency, cacheBytes: 1024 ** 3 },
    { concurrency: 1, cacheBytes: 512 * 1024 ** 2 },
  ];
  let lastError: unknown;
  for (const [i, attempt] of attempts.entries()) {
    try {
      await renderOnce(serveUrl, plan, out, preview, attempt);
      lastError = undefined;
      break;
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (i < attempts.length - 1) console.log(`  AVISO: render falhou (${msg.split('\n')[0]}). Tentando de novo com menos paralelismo...`);
    }
  }
  if (lastError) {
    fail(`render falhou duas vezes: ${lastError instanceof Error ? lastError.message.split('\n')[0] : String(lastError)}. Feche apps pesados e tente 'tut render ... --concurrency 1'.`);
  }
  if (!preview) {
    const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    writeFileSync(path.join(serieDir, 'entrega', `${id}.capitulos.txt`), plan.chapters.map((c) => `${fmt(c.t)} ${c.titulo}`).join('\n') + '\n');
  }
  const sheet = out.replace(/\.mp4$/, '.sheet.jpg');
  const seconds = plan.durationInFrames / plan.fps;
  await contactSheet(out, sheet, Math.max(1, Math.ceil(seconds / 16)));
  result({ ok: true, video: out, seconds: Number(seconds.toFixed(1)), sheet, renderSeconds: Math.round((Date.now() - started) / 1000) });
}

async function cmdStills(serieDir: string, id: string) {
  const plan = planVideo(serieDir, id);
  const { renderStill, selectComposition } = await import('@remotion/renderer');
  // renderStill shares the headless-browser cache dir with renderMedia (see process.chdir above).
  const serveUrl = await bundleFor(serieDir);
  const inputProps = { plan };
  const composition = await selectComposition({ serveUrl, id: 'Tutorial', inputProps });
  const qc = path.join(serieDir, 'videos', id, 'qc');
  rmSync(qc, { recursive: true, force: true });
  mkdirSync(qc, { recursive: true });
  const frames: number[] = [];
  for (const s of plan.segments) {
    if (s.kind !== 'step') frames.push(s.from + Math.floor(s.dur / 2));
    else {
      const firstClick = s.clicks[0];
      frames.push(s.from + Math.min(s.dur - 1, firstClick ? firstClick.f + 2 : Math.floor(s.dur / 3)));
      frames.push(s.from + s.dur - 2);
    }
  }
  let n = 0;
  for (const frame of frames) {
    n++;
    await renderStill({ composition, serveUrl, inputProps, frame, output: path.join(qc, `still-${String(n).padStart(3, '0')}.jpg`), imageFormat: 'jpeg', scale: 0.5 });
  }
  const rows = Math.ceil(frames.length / 3);
  const grid = path.join(qc, 'stills.jpg');
  await runOk('ffmpeg', ['-v', 'error', '-y', '-i', path.join(qc, 'still-%03d.jpg'), '-vf', `scale=640:-2,tile=3x${rows}:padding=8:color=0x222222`, '-frames:v', '1', grid]);
  result({ ok: true, grid, frames });
}

async function cmdDoctor() {
  const checks: Record<string, { ok: boolean; info: string }> = {};
  const has = async (cmd: string, args: string[]) => {
    try {
      const r = await run(cmd, args);
      return { ok: r.code === 0, info: (r.stdout.toString() || r.stderr).split('\n')[0]!.trim() };
    } catch {
      return { ok: false, info: 'não encontrado' };
    }
  };
  checks.ffmpeg = await has('ffmpeg', ['-version']);
  checks.ffprobe = await has('ffprobe', ['-version']);
  checks.node = { ok: Number(process.versions.node.split('.')[0]) >= 18, info: process.versions.node };
  checks.osascript = await has('osascript', ['-e', 'return "ok"']);
  checks.chrome = { ok: existsSync('/Applications/Google Chrome.app'), info: '/Applications/Google Chrome.app' };
  const list = await run('ffmpeg', ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', '']).catch(() => null);
  const screens = (list?.stderr ?? '').split('\n').filter((l) => /Capture screen \d+/.test(l)).map((l) => l.replace(/.*\] /, ''));
  checks.screens = { ok: screens.length > 0, info: screens.join(', ') || 'nenhuma tela de captura (macOS + ffmpeg avfoundation?)' };
  checks.engine = { ok: existsSync(path.join(ENGINE, 'node_modules', 'remotion')), info: ENGINE };
  const ok = Object.values(checks).every((c) => c.ok);
  for (const [k, v] of Object.entries(checks)) console.log(`  ${v.ok ? '✓' : '✗'} ${k.padEnd(10)} ${v.info}`);
  result({ ok, checks });
}

function cmdValidate(serieDir: string) {
  const series = loadSeries(serieDir);
  const report = series.videos.map((id) => {
    const v = loadVideo(serieDir, id);
    return { id, titulo: v.titulo, passos: v.passos.length };
  });
  for (const r of report) console.log(`  ✓ ${r.id}: ${r.titulo} (${r.passos} passos)`);
  result({ ok: true, videos: report });
}

function cmdMark(takeDir: string, name: string) {
  if (!/^(start|end|abort):[a-z0-9][a-z0-9-]*$/.test(name)) fail('Marca deve ser start:<passo>, end:<passo> ou abort:<passo>');
  mkdirSync(takeDir, { recursive: true });
  const ev = RawEvent.parse({ type: 'mark', t: Date.now(), name });
  writeFileSync(path.join(takeDir, 'marks.jsonl'), JSON.stringify(ev) + '\n', { flag: 'a' });
  result({ ok: true, mark: ev });
}

async function cmdSaveEvents(takeDir: string) {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  let text = Buffer.concat(chunks).toString().trim();
  // javascript_tool sometimes hands back the JSON string still quoted.
  if (text.startsWith('"')) text = JSON.parse(text) as string;
  const items = [JSON.parse(text)].flat();
  const valid = items.filter((i) => RawEvent.safeParse(i).success);
  mkdirSync(takeDir, { recursive: true });
  const n = readdirSync(takeDir).filter((f) => /^events-\d+\.json$/.test(f)).length + 1;
  const file = path.join(takeDir, `events-${n}.json`);
  writeFileSync(file, JSON.stringify(valid));
  const types: Record<string, number> = {};
  for (const v of valid) types[(v as { type: string }).type] = (types[(v as { type: string }).type] ?? 0) + 1;
  result({ ok: true, file, saved: valid.length, ignored: items.length - valid.length, types });
}

function cmdDeliver(serieDir: string) {
  const series = loadSeries(serieDir);
  const entrega = path.join(serieDir, 'entrega');
  const lines = [`# ${series.titulo_serie}`, '', `${series.produto}${series.publico ? ` · para ${series.publico}` : ''}`, ''];
  const missing: string[] = [];
  const ready = series.videos.filter((id) => {
    const has = existsSync(path.join(serieDir, 'videos', id, 'roteiro.json'));
    if (!has) missing.push(id);
    return has;
  });
  const videos = ready.map((id, i) => {
    const v = loadVideo(serieDir, id);
    const mp4 = path.join(entrega, `${id}.mp4`);
    const planFile = path.join(serieDir, 'videos', id, 'plan.json');
    if (!existsSync(mp4)) missing.push(id);
    const plan = existsSync(planFile) ? (readJson(planFile) as EditPlan) : null;
    const secs = plan ? plan.durationInFrames / plan.fps : 0;
    lines.push(`## ${i + 1}. ${v.titulo}`, '', `Arquivo: \`${id}.mp4\`${secs ? ` · ${Math.floor(secs / 60)}min${String(Math.round(secs % 60)).padStart(2, '0')}s` : ''}`, '');
    if (v.subtitulo) lines.push(v.subtitulo, '');
    const chapters = path.join(entrega, `${id}.capitulos.txt`);
    if (existsSync(chapters)) lines.push('Capítulos (cole na descrição do YouTube):', '', '```', readFileSync(chapters, 'utf8').trim(), '```', '');
    return { id, titulo: v.titulo, seconds: Number(secs.toFixed(1)), ok: existsSync(mp4) };
  });
  mkdirSync(entrega, { recursive: true });
  writeFileSync(path.join(entrega, 'LEIAME.md'), lines.join('\n'));
  if (missing.length) console.log(`  AVISO: vídeos ainda não renderizados: ${missing.join(', ')}`);
  result({ ok: missing.length === 0, folder: entrega, videos, missing });
}

function cmdClean(serieDir: string) {
  let freed = 0;
  const videos = path.join(serieDir, 'videos');
  for (const v of existsSync(videos) ? readdirSync(videos) : []) {
    for (const t of readdirSync(path.join(videos, v)).filter((d) => d.startsWith('take-'))) {
      const raw = path.join(videos, v, t, 'raw.mkv');
      if (existsSync(raw) && existsSync(path.join(videos, v, t, 'take.json'))) {
        freed += statSync(raw).size;
        rmSync(raw);
      }
    }
  }
  const calib = path.join(serieDir, '.tut', 'calibracao');
  if (existsSync(calib)) rmSync(calib, { recursive: true, force: true });
  result({ ok: true, freedMB: Math.round(freed / 1e6) });
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const need = (n: number, usage: string) => {
    if (args.length < n) fail(`uso: tut ${usage}`);
  };
  switch (cmd) {
    case 'doctor':
      return cmdDoctor();
    case 'validate':
      need(1, 'validate <pasta-da-serie>');
      return cmdValidate(abs(args[0]!));
    case 'calibrate': {
      need(1, 'calibrate <pasta-da-serie>');
      const serieDir = abs(args[0]!);
      const { capture, preview } = await calibrate(serieDir, path.join(serieDir, '.tut', 'calibracao'));
      console.log(`  Viewport na tela: ${capture.crop.w}x${capture.crop.h} em (${capture.crop.x},${capture.crop.y}) de ${capture.screen.w}x${capture.screen.h}`);
      return result({ ok: true, capture, preview });
    }
    case 'prepare': {
      need(1, 'prepare <pasta-da-take>');
      const r = await prepareTake(abs(args[0]!));
      console.log(`  take ${r.take.id}: ${r.take.duration.toFixed(1)}s, ${r.take.width}x${r.take.height}, flashes vídeo/página ${r.flashesVideo}/${r.flashesPage}`);
      console.log(`  passos completos: ${r.steps.join(', ') || '(nenhum)'}${r.incomplete.length ? ` | incompletos: ${r.incomplete.join(', ')}` : ''}`);
      for (const w of r.warnings) console.log(`  AVISO: ${w}`);
      return result({ ok: true, take: r.take.video, steps: r.steps, incomplete: r.incomplete, counts: r.counts, crop: r.crop, warnings: r.warnings });
    }
    case 'plan': {
      need(2, 'plan <pasta-da-serie> <video-id>');
      const plan = planVideo(abs(args[0]!), args[1]!);
      return result({ ok: true, seconds: plan.durationInFrames / plan.fps, chapters: plan.chapters });
    }
    case 'stills':
      need(2, 'stills <pasta-da-serie> <video-id>');
      return cmdStills(abs(args[0]!), args[1]!);
    case 'render':
      need(2, 'render <pasta-da-serie> <video-id> [--preview] [--concurrency N]');
      return cmdRender(abs(args[0]!), args[1]!, args.includes('--preview'), args.includes('--concurrency') ? Number(args[args.indexOf('--concurrency') + 1]) : null);
    case 'sheet': {
      need(1, 'sheet <video.mp4> [segundos-entre-frames]');
      const out = abs(args[0]!).replace(/\.mp4$/, '.sheet.jpg');
      await contactSheet(abs(args[0]!), out, Number(args[1] ?? 3));
      return result({ ok: true, sheet: out });
    }
    case 'mark':
      need(2, 'mark <pasta-da-take> start:<passo>|end:<passo>|abort:<passo>');
      return cmdMark(abs(args[0]!), args[1]!);
    case 'save-events':
      need(1, 'save-events <pasta-da-take>  (JSON do __tut.dump() via stdin)');
      return cmdSaveEvents(abs(args[0]!));
    case 'clean':
      need(1, 'clean <pasta-da-serie>');
      return cmdClean(abs(args[0]!));
    case 'deliver':
      need(1, 'deliver <pasta-da-serie>');
      return cmdDeliver(abs(args[0]!));
    case 'paths':
      return result({ ok: true, skill: SKILL, engine: ENGINE, recorder: path.join(SKILL, 'assets', 'recorder.js') });
    default:
      console.log(
        'comandos: doctor | validate <serie> | calibrate <serie> | prepare <take> | plan <serie> <video> | stills <serie> <video> | render <serie> <video> [--preview] | deliver <serie> | sheet <mp4> | mark <take> <marca> | save-events <take> | clean <serie> | paths',
      );
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
