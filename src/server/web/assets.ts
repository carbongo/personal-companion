/**
 * Static client assets — one stylesheet and three small, dependency-free
 * scripts (chat, memory admin, setup wizard). Kept as strings and served from
 * routes (see ./index.ts) so the app needs no build step and no bundler: this
 * is the whole point of the Hono-JSX, no-build web layer (see docs/tech-stack.md).
 */

export const APP_CSS = `
:root {
	--bg: #0f1115; --panel: #171a21; --panel-2: #1e222b; --line: #2a2f3a;
	--text: #e6e8ee; --muted: #9aa3b2; --accent: #6ea8fe; --accent-ink: #0b1020;
	--ok: #3fb950; --bad: #f85149; --radius: 12px;
}
@media (prefers-color-scheme: light) {
	:root {
		--bg: #f6f7f9; --panel: #ffffff; --panel-2: #f0f2f5; --line: #dfe3ea;
		--text: #1b1f27; --muted: #5a6472; --accent: #2f6fed; --accent-ink: #ffffff;
	}
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
	margin: 0; background: var(--bg); color: var(--text);
	font: 15px/1.55 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
a { color: var(--accent); text-decoration: none; }
.wrap { max-width: 860px; margin: 0 auto; padding: 0 16px; }
header.bar {
	border-bottom: 1px solid var(--line); background: var(--panel);
	position: sticky; top: 0; z-index: 5;
}
header.bar .wrap { display: flex; align-items: center; gap: 18px; height: 56px; }
header.bar .name { font-weight: 600; }
header.bar nav { margin-left: auto; display: flex; gap: 16px; }
header.bar nav a { color: var(--muted); }
header.bar nav a.active, header.bar nav a:hover { color: var(--text); }
.sub { color: var(--muted); font-size: 13px; }
main { padding: 22px 0 60px; }
h1 { font-size: 20px; margin: 0 0 4px; }
h2 { font-size: 15px; margin: 26px 0 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; }
label, .caption { display: block; font-size: 13px; color: var(--muted); margin: 14px 0 6px; }
.caption { font-weight: 500; }
input, textarea, select, button { font: inherit; color: inherit; }
input[type=text], input[type=password], input[type=number], textarea, select {
	width: 100%; background: var(--panel-2); border: 1px solid var(--line);
	border-radius: 8px; padding: 9px 11px; color: var(--text);
}
textarea { resize: vertical; min-height: 80px; }
button {
	background: var(--accent); color: var(--accent-ink); border: 0; cursor: pointer;
	border-radius: 8px; padding: 9px 14px; font-weight: 600;
}
button.ghost { background: transparent; color: var(--text); border: 1px solid var(--line); font-weight: 500; }
button:disabled { opacity: .5; cursor: default; }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.note { font-size: 13px; padding: 10px 12px; border-radius: 8px; margin-top: 10px; }
.note.ok { background: rgba(63,185,80,.12); color: var(--ok); }
.note.bad { background: rgba(248,81,73,.12); color: var(--bad); }
.note.info { background: var(--panel-2); color: var(--muted); }
.hidden { display: none !important; }

/* chat */
.chat { display: flex; flex-direction: column; height: calc(100vh - 56px - 44px); }
.msgs { flex: 1; overflow-y: auto; padding: 8px 0; display: flex; flex-direction: column; gap: 10px; }
.msg { max-width: 80%; padding: 9px 13px; border-radius: 14px; white-space: pre-wrap; word-wrap: break-word; }
.msg.user { align-self: flex-end; background: var(--accent); color: var(--accent-ink); border-bottom-right-radius: 4px; }
.msg.assistant { align-self: flex-start; background: var(--panel); border: 1px solid var(--line); border-bottom-left-radius: 4px; }
.msg.kind { font-size: 11px; opacity: .7; }
.composer { display: flex; gap: 8px; padding: 12px 0 4px; border-top: 1px solid var(--line); align-items: flex-end; }
.composer textarea { min-height: 0; height: 44px; max-height: 160px; }
.composer .icon { width: 44px; height: 44px; padding: 0; font-size: 18px; line-height: 1; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; }
.composer .icon.recording { background: var(--bad); color: #fff; border-color: var(--bad); animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
.empty { color: var(--muted); text-align: center; margin-top: 40px; }
.msg .thumb { display: block; margin-top: 6px; max-width: 220px; max-height: 220px; border-radius: 8px; }
.msg.info { background: var(--panel-2); color: var(--muted); font-size: 13px; }
.attachments { display: flex; gap: 8px; flex-wrap: wrap; padding: 8px 0 0; }
.attachments .chip { position: relative; width: 56px; height: 56px; border-radius: 8px; overflow: hidden; border: 1px solid var(--line); }
.attachments .chip img { width: 100%; height: 100%; object-fit: cover; }
.attachments .chip button { position: absolute; top: 1px; right: 1px; width: 18px; height: 18px; padding: 0; border-radius: 50%; background: rgba(0,0,0,.6); color: #fff; font-size: 12px; line-height: 1; border: 0; }

/* lists */
.mem { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid var(--line); }
.mem .body { flex: 1; }
.mem .tags { color: var(--muted); font-size: 12px; }
.mem button { background: transparent; color: var(--bad); border: 1px solid var(--line); padding: 4px 9px; font-weight: 500; }
.day { padding: 12px 0; border-bottom: 1px solid var(--line); }
.day .d { color: var(--muted); font-size: 13px; margin-bottom: 4px; }

/* edit/preview tabs */
.tabs { gap: 4px; margin-bottom: 6px; }
.tab { background: transparent; color: var(--muted); border: 1px solid var(--line); padding: 4px 12px; font-weight: 500; }
.tab.on { background: var(--panel-2); color: var(--text); }

/* rendered markdown */
.md { line-height: 1.55; word-wrap: break-word; }
.md > :first-child { margin-top: 0; }
.md > :last-child { margin-bottom: 0; }
.md h1, .md h2, .md h3, .md h4 { margin: 14px 0 6px; line-height: 1.25; }
.md h1 { font-size: 1.4em; } .md h2 { font-size: 1.2em; } .md h3 { font-size: 1.05em; } .md h4 { font-size: 1em; }
.md p { margin: 8px 0; }
.md ul, .md ol { margin: 8px 0; padding-left: 22px; }
.md li { margin: 2px 0; }
.md a { color: var(--accent); }
.md blockquote { margin: 8px 0; padding: 2px 12px; border-left: 3px solid var(--line); color: var(--muted); }
.md.summary { white-space: normal; }
`;

export const CHAT_JS = `
const msgs = document.getElementById('msgs');
const ta = document.getElementById('text');
const send = document.getElementById('send');
const fileInput = document.getElementById('file');
const attachBtn = document.getElementById('attach');
const micBtn = document.getElementById('mic');
const attachRow = document.getElementById('attachments');

// Behaves like the Telegram channel: a burst of quick messages folds into one
// turn after a short idle window (never one reply per line), the reply splits
// into separate bubbles, images attach, and voice notes are transcribed. The
// window matches Telegram's — both are fetched from /api/state below.
const cfg = { idle: 2500, max: 15000, voice: false };

let staged = [];       // images staged for the next message: { b64, url }
let voiceFlag = false; // the next send originated from a voice note
let buffer = [];       // lines waiting to be folded into one turn
let idleTimer = null, maxTimer = null, flushing = false;

function el(role, content, kind) {
	const d = document.createElement('div');
	d.className = 'msg ' + (role === 'user' ? 'user' : 'assistant');
	if (kind && kind !== 'text') { const k = document.createElement('div'); k.className = 'kind'; k.textContent = kind; d.appendChild(k); }
	if (content) d.appendChild(document.createTextNode(content));
	return d;
}
function userBubble(text, urls, kind) {
	const d = el('user', text, kind);
	for (const url of (urls || [])) { const img = document.createElement('img'); img.className = 'thumb'; img.src = url; d.appendChild(img); }
	return d;
}
function scroll() { msgs.scrollTop = msgs.scrollHeight; }
function note(text) { const n = document.createElement('div'); n.className = 'msg assistant info'; n.textContent = text; msgs.appendChild(n); scroll(); return n; }

// An assistant reply can span paragraphs; show each as its own bubble — the same
// texting feel the Telegram channel produces by splitting on blank lines.
function splitParas(content) {
	const parts = String(content).split(/\\n\\s*\\n/).map((s) => s.trim()).filter(Boolean);
	return parts.length ? parts : [String(content)];
}
function appendAssistant(content, kind) {
	splitParas(content).forEach((p, i) => msgs.appendChild(el('assistant', p, i === 0 ? kind : undefined)));
}

function readAsBase64(file) {
	return new Promise((resolve, reject) => {
		const fr = new FileReader();
		fr.onload = () => { const s = String(fr.result); resolve(s.slice(s.indexOf(',') + 1)); };
		fr.onerror = reject;
		fr.readAsDataURL(file);
	});
}

function renderStaged() {
	attachRow.innerHTML = '';
	attachRow.classList.toggle('hidden', staged.length === 0);
	staged.forEach((a, i) => {
		const chip = document.createElement('div'); chip.className = 'chip';
		const img = document.createElement('img'); img.src = a.url; chip.appendChild(img);
		const x = document.createElement('button'); x.type = 'button'; x.textContent = '×';
		x.addEventListener('click', () => { staged.splice(i, 1); renderStaged(); });
		chip.appendChild(x); attachRow.appendChild(chip);
	});
}

async function addFiles(files) {
	for (const file of files) {
		if (file.type.indexOf('image/') === 0) {
			const b64 = await readAsBase64(file);
			staged.push({ b64: b64, url: 'data:' + file.type + ';base64,' + b64 });
			renderStaged();
		} else if (file.type.indexOf('audio/') === 0) {
			await transcribeInto(file, file.name || 'audio');
		}
	}
}

// Send a voice note to the shared STT backend and drop the transcript into the
// composer for a quick review before sending (the send is tagged 'voice').
async function transcribeInto(blob, name) {
	if (!cfg.voice) { note("Voice isn't set up — turn on speech-to-text in Settings."); return; }
	const n = note('Transcribing voice note…');
	try {
		const fd = new FormData(); fd.append('file', blob, name);
		const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
		const data = await r.json();
		n.remove();
		if (r.ok && data.text) {
			ta.value = (ta.value ? ta.value + ' ' : '') + data.text; voiceFlag = true;
			ta.style.height = '44px'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; ta.focus();
		} else { note(data.error || "I couldn't make out that voice note."); }
	} catch { n.remove(); note("Couldn't reach the server for transcription."); }
}

async function load() {
	try {
		const r = await fetch('/api/messages');
		if (!r.ok) return;
		const data = await r.json();
		msgs.innerHTML = '';
		if (!data.messages.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Say hello to start the conversation.'; msgs.appendChild(e); }
		for (const m of data.messages) {
			if (m.role === 'assistant') appendAssistant(m.content, m.kind);
			else msgs.appendChild(el(m.role, m.content, m.kind));
		}
		scroll();
	} catch {}
}

function armTimers() {
	if (idleTimer) clearTimeout(idleTimer);
	idleTimer = setTimeout(flush, cfg.idle);
	if (!maxTimer) maxTimer = setTimeout(flush, cfg.max);
}

// Stage one composed line (text + any images) into the current burst, show it
// immediately like a sent message, and (re)arm the batch window.
function submit() {
	const text = ta.value.trim();
	const images = staged.map((a) => a.b64);
	const urls = staged.map((a) => a.url);
	if (!text && !images.length) return;
	const kind = voiceFlag ? 'voice' : (images.length ? 'photo' : 'text');
	const empty = msgs.querySelector('.empty'); if (empty) empty.remove();
	msgs.appendChild(userBubble(text, urls, kind)); scroll();
	buffer.push({ text: text, images: images, kind: kind });
	ta.value = ''; ta.style.height = '44px'; staged = []; voiceFlag = false; renderStaged();
	armTimers();
}

async function flush() {
	if (flushing) return; // a send is in flight; its finally re-arms if needed
	if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
	if (maxTimer) { clearTimeout(maxTimer); maxTimer = null; }
	if (!buffer.length) return;

	const items = buffer; buffer = [];
	const text = items.map((i) => i.text).filter(Boolean).join('\\n');
	const images = items.reduce((acc, i) => acc.concat(i.images), []);
	const kind = images.length ? 'photo' : (items.some((i) => i.kind === 'voice') ? 'voice' : 'text');

	flushing = true; send.disabled = true;
	const pending = el('assistant', '…'); msgs.appendChild(pending); scroll();
	try {
		const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text, images: images, kind: kind }) });
		const data = await r.json();
		if (r.ok) { pending.remove(); appendAssistant(data.reply); }
		else pending.replaceWith(el('assistant', data.error || 'Something went wrong.'));
	} catch {
		pending.replaceWith(el('assistant', "Couldn't reach the server."));
	}
	flushing = false; send.disabled = false; scroll(); ta.focus();
	if (buffer.length) armTimers(); // messages arrived mid-flight → next turn
}

// --- voice recording (works on secure origins incl. localhost) ---------------
let recorder = null, chunks = [];
async function toggleRecord() {
	if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
	if (!navigator.mediaDevices || !window.MediaRecorder) { note('Recording needs a secure (https or localhost) connection — attach an audio file instead.'); return; }
	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		recorder = new MediaRecorder(stream); chunks = [];
		recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
		recorder.onstop = () => {
			micBtn.classList.remove('recording');
			stream.getTracks().forEach((t) => t.stop());
			const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
			if (blob.size) transcribeInto(blob, 'voice.webm');
		};
		recorder.start(); micBtn.classList.add('recording');
	} catch { note("Couldn't access the microphone."); }
}

attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { addFiles(Array.from(fileInput.files)); fileInput.value = ''; });
micBtn.addEventListener('click', toggleRecord);
send.addEventListener('click', submit);
ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
ta.addEventListener('input', () => { ta.style.height = '44px'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; });
ta.addEventListener('paste', (e) => { const files = Array.from((e.clipboardData && e.clipboardData.files) || []); if (files.length) { e.preventDefault(); addFiles(files); } });

async function init() {
	try {
		const r = await fetch('/api/state');
		if (r.ok) {
			const s = await r.json();
			if (s.chat) { cfg.idle = s.chat.batchIdleMs || cfg.idle; cfg.max = s.chat.batchMaxMs || cfg.max; cfg.voice = !!s.chat.voice; }
		}
	} catch {}
	micBtn.classList.toggle('hidden', !cfg.voice);
}
init(); load();
`;

export const ADMIN_JS = `
const core = document.getElementById('core');
const coreNote = document.getElementById('coreNote');
const memList = document.getElementById('memList');
const memInput = document.getElementById('memInput');
const memTags = document.getElementById('memTags');
const memSearch = document.getElementById('memSearch');
const sumList = document.getElementById('sumList');
const rollupNote = document.getElementById('rollupNote');

function note(node, msg, kind) { node.textContent = msg; node.className = 'note ' + kind; node.classList.remove('hidden'); setTimeout(() => node.classList.add('hidden'), 4000); }

// Minimal, safe Markdown renderer (prose only). HTML is escaped first, so the
// output is injection-safe; then headings, bold/italic, links, lists, and
// block-quotes are formatted. No code spans (the companion's prose has none).
function mdToHtml(src) {
	var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
	var inline = function (s) {
		return esc(s)
			.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
			.replace(/\\*([^*]+)\\*/g, '<em>$1</em>')
			.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
	};
	var lines = String(src).replace(/\\r\\n/g, '\\n').split('\\n');
	var out = '', i = 0;
	while (i < lines.length) {
		var line = lines[i];
		if (/^\\s*$/.test(line)) { i++; continue; }
		var h = line.match(/^(#{1,6})\\s+(.*)$/);
		if (h) { var lv = h[1].length; out += '<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>'; i++; continue; }
		if (/^\\s*[-*+]\\s+/.test(line)) {
			out += '<ul>';
			while (i < lines.length && /^\\s*[-*+]\\s+/.test(lines[i])) { out += '<li>' + inline(lines[i].replace(/^\\s*[-*+]\\s+/, '')) + '</li>'; i++; }
			out += '</ul>'; continue;
		}
		if (/^\\s*\\d+\\.\\s+/.test(line)) {
			out += '<ol>';
			while (i < lines.length && /^\\s*\\d+\\.\\s+/.test(lines[i])) { out += '<li>' + inline(lines[i].replace(/^\\s*\\d+\\.\\s+/, '')) + '</li>'; i++; }
			out += '</ol>'; continue;
		}
		if (/^\\s*>\\s?/.test(line)) {
			var q = [];
			while (i < lines.length && /^\\s*>\\s?/.test(lines[i])) { q.push(inline(lines[i].replace(/^\\s*>\\s?/, ''))); i++; }
			out += '<blockquote>' + q.join('<br>') + '</blockquote>'; continue;
		}
		var para = [];
		while (i < lines.length && !/^\\s*$/.test(lines[i]) && !/^(#{1,6})\\s|^\\s*[-*+]\\s|^\\s*\\d+\\.\\s|^\\s*>/.test(lines[i])) { para.push(lines[i]); i++; }
		out += '<p>' + inline(para.join(' ')) + '</p>';
	}
	return out;
}

const corePreview = document.getElementById('corePreview');
const coreEditTab = document.getElementById('coreEditTab');
const corePreviewTab = document.getElementById('corePreviewTab');
function showCoreTab(preview) {
	corePreview.classList.toggle('hidden', !preview);
	core.classList.toggle('hidden', preview);
	coreEditTab.classList.toggle('on', !preview);
	corePreviewTab.classList.toggle('on', preview);
	if (preview) corePreview.innerHTML = mdToHtml(core.value);
}
coreEditTab.addEventListener('click', () => showCoreTab(false));
corePreviewTab.addEventListener('click', () => showCoreTab(true));

async function loadCore() { const r = await fetch('/api/core'); if (r.ok) { core.value = (await r.json()).contentMd; if (!corePreview.classList.contains('hidden')) corePreview.innerHTML = mdToHtml(core.value); } }
document.getElementById('saveCore').addEventListener('click', async () => {
	const r = await fetch('/api/core', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contentMd: core.value }) });
	note(coreNote, r.ok ? 'Core saved.' : 'Save failed.', r.ok ? 'ok' : 'bad');
});

async function loadMemories(q) {
	const r = await fetch('/api/memories' + (q ? '?q=' + encodeURIComponent(q) : ''));
	if (!r.ok) return;
	const data = await r.json(); memList.innerHTML = '';
	if (!data.memories.length) { const e = document.createElement('div'); e.className = 'sub'; e.textContent = 'No memories yet.'; memList.appendChild(e); return; }
	for (const m of data.memories) {
		const row = document.createElement('div'); row.className = 'mem';
		const body = document.createElement('div'); body.className = 'body';
		const c = document.createElement('div'); c.className = 'md'; c.innerHTML = mdToHtml(m.content); body.appendChild(c);
		if (m.tags) { const t = document.createElement('div'); t.className = 'tags'; t.textContent = m.tags; body.appendChild(t); }
		const del = document.createElement('button'); del.textContent = 'Delete';
		del.addEventListener('click', async () => { if (await fetch('/api/memories/' + m.id, { method: 'DELETE' }).then(r => r.ok)) row.remove(); });
		row.appendChild(body); row.appendChild(del); memList.appendChild(row);
	}
}
document.getElementById('addMem').addEventListener('click', async () => {
	const content = memInput.value.trim(); if (!content) return;
	const r = await fetch('/api/memories', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, tags: memTags.value.trim() || null }) });
	if (r.ok) { memInput.value = ''; memTags.value = ''; loadMemories(memSearch.value.trim()); }
});
let searchTimer; memSearch.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadMemories(memSearch.value.trim()), 200); });

async function loadSummaries() {
	const r = await fetch('/api/summaries'); if (!r.ok) return;
	const data = await r.json(); sumList.innerHTML = '';
	if (!data.summaries.length) { const e = document.createElement('div'); e.className = 'sub'; e.textContent = 'No daily summaries yet — they appear after the nightly roll-up.'; sumList.appendChild(e); return; }
	for (const s of data.summaries) {
		const row = document.createElement('div'); row.className = 'day';
		const d = document.createElement('div'); d.className = 'd'; d.textContent = s.day;
		const body = document.createElement('div'); body.className = 's md summary'; body.innerHTML = mdToHtml(s.summaryMd);
		row.appendChild(d); row.appendChild(body); sumList.appendChild(row);
	}
}
document.getElementById('runRollup').addEventListener('click', async (e) => {
	e.target.disabled = true; note(rollupNote, 'Running roll-up…', 'info');
	try {
		const r = await fetch('/api/rollup', { method: 'POST' }); const data = await r.json();
		note(rollupNote, r.ok ? ('Summarized ' + data.summarized + ' day(s).') : (data.error || 'Roll-up failed.'), r.ok ? 'ok' : 'bad');
		loadSummaries();
	} catch { note(rollupNote, 'Roll-up failed.', 'bad'); }
	e.target.disabled = false;
});

loadCore(); loadMemories(); loadSummaries();
`;

export const SETUP_JS = `
const provider = document.getElementById('provider');
const ollamaRow = document.getElementById('ollamaRow');
const hostedRows = document.getElementById('hostedRows');
const testNote = document.getElementById('testNote');
const saveNote = document.getElementById('saveNote');
const presetRadios = () => Array.from(document.querySelectorAll('input[name=preset]'));
// Trimmed value (text/number/select) and raw value (secrets, kept as typed).
const val = (id) => document.getElementById(id).value.trim();
const raw = (id) => document.getElementById(id).value;

function syncProvider() {
	const ollama = provider.value === 'ollama';
	ollamaRow.classList.toggle('hidden', !ollama);
	hostedRows.classList.toggle('hidden', ollama);
}
provider.addEventListener('change', syncProvider); syncProvider();

function body() {
	return {
		name: val('name'),
		owner: val('owner'),
		preset: (presetRadios().find(r => r.checked) || {}).value || 'companion',
		persona: val('persona'),
		coreSeed: val('coreSeed'),
		timezone: val('timezone'),
		dataDir: val('dataDir'),
		port: val('port'),
		webAuthPassword: raw('webAuthPassword'),
		provider: provider.value,
		model: val('model'),
		ollamaUrl: val('ollamaUrl'),
		baseUrl: val('baseUrl'),
		apiKey: raw('apiKey'),
		temperature: val('temperature'),
		numCtx: val('numCtx'),
		maxTokens: val('maxTokens'),
		think: val('think'),
		timeoutMs: val('timeoutMs'),
		historyLimit: val('historyLimit'),
		telegramToken: val('telegramToken'),
		telegramAllowedIds: val('telegramAllowedIds'),
		telegramReplySplit: val('telegramReplySplit'),
		telegramBatchIdleMs: val('telegramBatchIdleMs'),
		telegramBatchMaxMs: val('telegramBatchMaxMs'),
		memoryContextDays: val('memoryContextDays'),
		memoryLimit: val('memoryLimit'),
		memoryNoteTitles: val('memoryNoteTitles'),
		memorySummaryCron: val('memorySummaryCron'),
		webEnabled: val('webEnabled'),
		webSearchProvider: val('webSearchProvider'),
		tavilyKey: raw('tavilyKey'),
		webSteps: val('webSteps'),
		webResults: val('webResults'),
		webPageChars: val('webPageChars'),
		webSearchTimeoutMs: val('webSearchTimeoutMs'),
		webFetchTimeoutMs: val('webFetchTimeoutMs'),
		webMaxReqs: val('webMaxReqs'),
		sttProvider: val('sttProvider'),
		sttApiUrl: val('sttApiUrl'),
		sttApiKey: raw('sttApiKey'),
		sttModel: val('sttModel'),
		sttLocalModel: val('sttLocalModel'),
		sttLanguage: val('sttLanguage'),
		weatherLat: val('weatherLat'),
		weatherLon: val('weatherLon'),
		weatherLocationName: val('weatherLocationName'),
	};
}

document.getElementById('test').addEventListener('click', async (e) => {
	e.target.disabled = true; testNote.textContent = 'Testing the model connection…'; testNote.className = 'note info'; testNote.classList.remove('hidden');
	try {
		const b = body();
		const r = await fetch('/api/setup/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
		const data = await r.json();
		testNote.textContent = data.detail || (data.ok ? 'Connected.' : 'Failed.'); testNote.className = 'note ' + (data.ok ? 'ok' : 'bad');
	} catch { testNote.textContent = 'Test request failed.'; testNote.className = 'note bad'; }
	e.target.disabled = false;
});

document.getElementById('save').addEventListener('click', async (e) => {
	e.target.disabled = true; saveNote.classList.add('hidden');
	try {
		const r = await fetch('/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body()) });
		const data = await r.json();
		if (r.ok) {
			saveNote.innerHTML = 'Saved. Persona and facts apply now; other changes take effect after a restart (e.g. <code>bun start</code> or <code>docker compose restart</code>). <a href="/">Open the chat →</a>';
			saveNote.className = 'note ok';
		} else { saveNote.textContent = data.error || 'Save failed.'; saveNote.className = 'note bad'; }
		saveNote.classList.remove('hidden');
	} catch { saveNote.textContent = 'Save request failed.'; saveNote.className = 'note bad'; saveNote.classList.remove('hidden'); }
	e.target.disabled = false;
});
`;

/** filename → [body, content-type] for the asset route. */
export const ASSETS: Record<string, [string, string]> = {
	"app.css": [APP_CSS, "text/css; charset=utf-8"],
	"chat.js": [CHAT_JS, "text/javascript; charset=utf-8"],
	"admin.js": [ADMIN_JS, "text/javascript; charset=utf-8"],
	"setup.js": [SETUP_JS, "text/javascript; charset=utf-8"],
};
