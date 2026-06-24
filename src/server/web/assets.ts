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
.composer { display: flex; gap: 10px; padding: 12px 0 4px; border-top: 1px solid var(--line); }
.composer textarea { min-height: 0; height: 44px; max-height: 160px; }
.empty { color: var(--muted); text-align: center; margin-top: 40px; }

/* lists */
.mem { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid var(--line); }
.mem .body { flex: 1; }
.mem .tags { color: var(--muted); font-size: 12px; }
.mem button { background: transparent; color: var(--bad); border: 1px solid var(--line); padding: 4px 9px; font-weight: 500; }
.day { padding: 12px 0; border-bottom: 1px solid var(--line); }
.day .d { color: var(--muted); font-size: 13px; margin-bottom: 4px; }
.day .s { white-space: pre-wrap; }
`;

export const CHAT_JS = `
const msgs = document.getElementById('msgs');
const ta = document.getElementById('text');
const send = document.getElementById('send');

function el(role, content, kind) {
	const d = document.createElement('div');
	d.className = 'msg ' + (role === 'user' ? 'user' : 'assistant');
	if (kind && kind !== 'text') { const k = document.createElement('div'); k.className = 'kind'; k.textContent = kind; d.appendChild(k); }
	d.appendChild(document.createTextNode(content));
	return d;
}
function scroll() { msgs.scrollTop = msgs.scrollHeight; }

// An assistant reply can span paragraphs; show each as its own bubble — the same
// texting feel the Telegram channel produces by splitting on blank lines.
function splitParas(content) {
	const parts = String(content).split(/\\n\\s*\\n/).map((s) => s.trim()).filter(Boolean);
	return parts.length ? parts : [String(content)];
}
function appendAssistant(content, kind) {
	splitParas(content).forEach((p, i) => msgs.appendChild(el('assistant', p, i === 0 ? kind : undefined)));
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

async function submit() {
	const text = ta.value.trim();
	if (!text) return;
	ta.value = ''; ta.style.height = '44px';
	const empty = msgs.querySelector('.empty'); if (empty) empty.remove();
	msgs.appendChild(el('user', text)); scroll();
	send.disabled = true; ta.disabled = true;
	const pending = el('assistant', '…'); msgs.appendChild(pending); scroll();
	try {
		const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
		const data = await r.json();
		if (r.ok) { pending.remove(); appendAssistant(data.reply); }
		else pending.replaceWith(el('assistant', data.error || 'Something went wrong.'));
	} catch {
		pending.replaceWith(el('assistant', "Couldn't reach the server."));
	}
	send.disabled = false; ta.disabled = false; scroll(); ta.focus();
}

send.addEventListener('click', submit);
ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
ta.addEventListener('input', () => { ta.style.height = '44px'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; });
load();
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

async function loadCore() { const r = await fetch('/api/core'); if (r.ok) core.value = (await r.json()).contentMd; }
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
		body.appendChild(document.createTextNode(m.content));
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
		const body = document.createElement('div'); body.className = 's'; body.textContent = s.summaryMd;
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

function syncProvider() {
	const ollama = provider.value === 'ollama';
	ollamaRow.classList.toggle('hidden', !ollama);
	hostedRows.classList.toggle('hidden', ollama);
}
provider.addEventListener('change', syncProvider); syncProvider();

function body() {
	return {
		name: document.getElementById('name').value.trim(),
		owner: document.getElementById('owner').value.trim(),
		preset: (presetRadios().find(r => r.checked) || {}).value || 'companion',
		persona: document.getElementById('persona').value.trim(),
		coreSeed: document.getElementById('coreSeed').value.trim(),
		provider: provider.value,
		model: document.getElementById('model').value.trim(),
		ollamaUrl: document.getElementById('ollamaUrl').value.trim(),
		baseUrl: document.getElementById('baseUrl').value.trim(),
		apiKey: document.getElementById('apiKey').value,
		telegramToken: document.getElementById('telegramToken').value.trim(),
		telegramAllowedIds: document.getElementById('telegramAllowedIds').value.trim(),
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
			saveNote.innerHTML = 'Saved. Persona and facts apply now; model, name, and channel changes take effect after a restart (e.g. <code>bun start</code> or <code>docker compose restart</code>). <a href="/">Open the chat →</a>';
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
