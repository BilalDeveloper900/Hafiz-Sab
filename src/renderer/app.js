const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const num = (n) => Number(n).toLocaleString();
// '2026-11-18 10:16' -> '18 Nov 2026' (easier to read than ISO dates)
const niceDate = (s) => (s ? new Date(s.slice(0, 10)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const icon = (name) => `<svg class="icon"><use href="#i-${name}"/></svg>`;
const pill = (text, color, dot = true) => `<span class="pill ${dot ? 'dot ' : ''}soft is-${color}">${esc(text)}</span>`;
const LOW_STOCK = 10; // shortcut: one threshold for all colours; make it per colour if the client asks

// ---------- shared UI helpers ----------
function flash(text, ok = false) {
  const m = $('#msg');
  m.innerHTML = `${ok ? icon('check') : ''}${esc(text)}`;
  m.classList.toggle('error', !ok);
  m.hidePopover?.();
  m.showPopover(); // re-show so it sits above any open popup
  clearTimeout(flash.t);
  flash.t = setTimeout(() => m.hidePopover(), 3500);
}

// Wraps every main-process call so errors show to the user instead of vanishing.
async function call(channel, arg) {
  try {
    return await window.api(channel, arg);
  } catch (e) {
    flash(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    throw e;
  }
}

const formData = (form) => Object.fromEntries(new FormData(form));

function table(el, headers, rows, empty = 'Nothing here yet') {
  el.innerHTML =
    `<thead><tr>${headers.map((h) => `<th${h.num ? ' class="num"' : ''}>${h.label ?? h}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.join('') || `<tr><td class="empty" colspan="${headers.length}">${empty}</td></tr>`}</tbody>`;
}

function statCard(color, iconName, label, value, sub) {
  return `<div class="card stat"><div class="stat-icon is-${color}">${icon(iconName)}</div>
    <div><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-sub">${sub}</div></div></div>`;
}

// Resets a form and fills it from `values` (used by popups and the design page).
function fillForm(f, values = {}) {
  f.reset();
  if (f.elements.id) f.elements.id.value = ''; // reset() leaves hidden inputs alone
  for (const [k, v] of Object.entries(values)) {
    const el = f.elements[k];
    if (el?.type === 'checkbox') el.checked = !!v;
    else if (el) el.value = v ?? '';
  }
  return f;
}

// Opens a popup with its form reset and filled from `values`.
function openModal(sel, values = {}, title) {
  const d = $(sel);
  const f = fillForm(d.querySelector('form'), values);
  if (title) d.querySelector('[data-title]').textContent = title;
  d.showModal();
  return f;
}

// Runs `save` on submit; the popup closes only if saving worked, so typed data is never lost.
function onModalSubmit(sel, save) {
  const d = $(sel);
  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await save(formData(e.target), e.target);
      d.close();
    } catch {} // call() already showed the error
  });
}

function confirmBox(text, okLabel = 'Delete') {
  const d = $('#confirm-modal');
  d.querySelector('p').textContent = text;
  d.querySelector('button[value=ok]').textContent = okLabel;
  d.returnValue = ''; // Esc keeps the old value otherwise
  d.showModal();
  return new Promise((resolve) => (d.onclose = () => resolve(d.returnValue === 'ok')));
}

document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => b.closest('dialog').close()));
// Click on the dark backdrop closes the popup.
document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => e.target === d && d.close()));

// ---------- navigation ----------
// navId: which sidebar item stays highlighted (the design page belongs to Designs).
function showPage(id, title, sub, navId = id) {
  document.querySelectorAll('[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === navId));
  document.querySelectorAll('main section').forEach((s) => (s.hidden = s.id !== id));
  $('#page-title').textContent = title;
  $('#page-sub').textContent = sub;
}
document.querySelectorAll('[data-page]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    if (!(await leaveDesignPage())) return;
    dirty = false;
    showPage(btn.dataset.page, btn.dataset.title, btn.dataset.sub);
  })
);
$('#backup').onclick = async () => (await call('backup')) && flash('Backup saved', true);

// ---------- calculator ----------
const swatch = (c) => `<span class="swatch" style="background:${/^#[0-9a-f]{3,6}$/i.test(c?.hex) ? c.hex : 'transparent'}"></span>`;
const colorById = (id) => colors.find((c) => c.id === id);

let picked = []; // [{ id, stitches }] colours of this design, in needle order
let editing = null; // id of the design being edited, null for a new one

function calcInput() {
  const d = formData($('#calc-form'));
  for (const k of ['heads', 'pieces', 'metersPer1000Stitches', 'coneLengthM']) d[k] = Number(d[k]);
  return { ...d, colorIds: picked.map((p) => p.id), colorStitches: picked.map((p) => p.stitches) };
}

// Live: recalculates on every change; incomplete input just shows a hint.
async function runCalc() {
  const d = calcInput();
  $('#settings-sum').textContent = `· ${num(d.metersPer1000Stitches)} m per 1,000 stitches, ${num(d.coneLengthM)} m per cone`;
  $('#color-count').textContent = picked.length ? `· ${picked.length} added` : '';
  let r = null;
  try {
    if (picked.length) r = await window.api('calc', d);
  } catch {} // half-filled: shown as a hint below
  fillColorRows(r);
  $('#calc-result').innerHTML = r
    ? resultBox(r, { colors: picked.length, heads: d.heads, stitches: r.stitches })
    : `<p class="result-hint">${picked.length ? 'Enter the stitches for every colour to see how many cones you need.' : 'Add the colours of this design and their stitches.'}</p>`;
}

// One answer up front (total cones), the supporting numbers beside it.
function resultBox(r, d) {
  return `<div class="result">
    <div class="result-main">
      <span class="stat-icon is-blue">${icon('cone')}</span>
      <div><small>Cones needed</small><b>${num(r.totalCones)}</b><small>${d.colors} colour${d.colors === 1 ? "" : "s"} × ${d.heads} heads</small></div>
    </div>
    <ul class="result-facts">
      <li><span>Total stitches</span><b>${num(d.stitches)}</b></li>
      <li><span>Thread per head</span><b>${num(r.threadPerHeadM)} m</b></li>
      <li><span>Total thread</span><b>${num(r.threadTotalM)} m</b></li>
    </ul>
  </div>`;
}
$('#calc-form').addEventListener('input', runCalc);
// A wrong value inside the folded thread settings would be hidden: unfold it.
$('#calc-form').addEventListener('invalid', (e) => e.target.closest('details')?.setAttribute('open', ''), true);

// --- colour rows: each colour with its own stitches, thread and cones ---
const rowsBox = $('#color-rows');
const colorCell = (c) => `<div class="row">${swatch(c)}<b>${esc(c?.code)}</b><span class="muted">${esc(c?.name)}</span></div>`;

function renderColorRows() {
  rowsBox.innerHTML = picked.length
    ? `<table class="table color-table">
        <thead><tr><th>#</th><th>Colour</th><th>Stitches</th><th class="num">Thread per head</th><th class="num">Cones</th><th></th></tr></thead>
        <tbody>${picked
          .map((p, i) => {
            const c = colorById(p.id);
            return `<tr data-i="${i}"><td class="muted">${i + 1}</td><td>${colorCell(c)}</td>
              <td><input class="input input-sm" type="number" min="1" step="1" required data-i="${i}" value="${p.stitches || ''}"
                placeholder="e.g. 30000" aria-label="Stitches for ${esc(c.code)}"></td>
              <td class="num" data-thread></td><td class="num"><b data-cones></b></td>
              <td class="num"><button type="button" class="icon-btn" data-unpick="${i}" aria-label="Remove ${esc(c.code)}">${icon('x')}</button></td></tr>`;
          })
          .join('')}</tbody>
        <tfoot><tr><td></td><td>Total</td><td data-total-stitches></td><td class="num" data-total-thread></td><td class="num" data-total-cones></td><td></td></tr></tfoot>
      </table>`
    : '';
  runCalc();
}

function fillColorRows(r) {
  rowsBox.querySelectorAll('tbody tr').forEach((tr, i) => {
    const pc = r?.perColor[i];
    tr.querySelector('[data-thread]').textContent = pc ? `${num(pc.threadPerHeadM)} m` : '—';
    tr.querySelector('[data-cones]').textContent = pc ? num(pc.cones) : '—';
  });
  if (!picked.length) return;
  rowsBox.querySelector('[data-total-stitches]').textContent = num(picked.reduce((s, p) => s + (p.stitches || 0), 0));
  rowsBox.querySelector('[data-total-thread]').textContent = r ? `${num(r.threadPerHeadM)} m` : '—';
  rowsBox.querySelector('[data-total-cones]').textContent = r ? num(r.totalCones) : '—';
}

// Typing stitches updates that colour (the form-level listener then recalculates).
rowsBox.addEventListener('input', (e) => {
  if (e.target.dataset.i) picked[Number(e.target.dataset.i)].stitches = Number(e.target.value) || 0;
});
// Enter after typing stitches jumps back to "add colour", so a whole design is: red ⏎ 30000 ⏎ blue ⏎ 20000 ⏎ ...
rowsBox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset.i) {
    e.preventDefault();
    search.focus();
  }
});
rowsBox.addEventListener('click', (e) => {
  const b = e.target.closest('[data-unpick]');
  if (b) picked.splice(Number(b.dataset.unpick), 1), renderColorRows(), (dirty = true);
});

// --- colour search: type to search, Enter/click to add ---
const search = $('#color-search');
const list = $('#color-options');
let matches = [];
let active = 0;

function openList() {
  const q = search.value.trim().toLowerCase();
  matches = colors.filter((c) => !picked.some((p) => p.id === c.id) && (!q || `${c.code} ${c.name}`.toLowerCase().includes(q)));
  active = Math.min(active, Math.max(matches.length - 1, 0));
  list.innerHTML =
    matches
      .map((c, i) => `<li role="option" id="opt-${c.id}" data-id="${c.id}" aria-selected="${i === active}">
        ${swatch(c)}<b>${esc(c.code)}</b>${esc(c.name)}<span class="stock">${num(c.stock)} cones</span></li>`)
      .join('') || `<li class="none">${colors.length ? 'No colour matches' : 'No colours yet. Add them in Thread Stock.'}</li>`;
  list.hidden = false;
  search.setAttribute('aria-expanded', 'true');
  const cur = list.querySelector('[aria-selected="true"]');
  search.setAttribute('aria-activedescendant', cur?.id ?? '');
  cur?.scrollIntoView({ block: 'nearest' });
}
function closeList() {
  list.hidden = true;
  search.setAttribute('aria-expanded', 'false');
}
function pick(id) {
  picked.push({ id, stitches: 0 });
  search.value = '';
  active = 0;
  closeList();
  renderColorRows();
  dirty = true;
  rowsBox.querySelector(`input[data-i="${picked.length - 1}"]`).focus(); // next: type its stitches
}

search.addEventListener('focus', openList);
search.addEventListener('blur', closeList);
search.addEventListener('input', () => ((active = 0), openList()));
search.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (matches.length) active = (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
    openList();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (matches[active]) pick(matches[active].id);
  } else if (e.key === 'Escape') {
    closeList();
  }
});
// mousedown (not click) so the click lands before the search box loses focus
list.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const li = e.target.closest('[data-id]');
  if (li) pick(Number(li.dataset.id));
});

// --- add / edit a design: one page for both ---
// Designs saved before per-colour stitches existed get their total split evenly, to be corrected.
function pickedOf(d) {
  const ids = idsOf(d);
  const st = (d.color_stitches ?? '').split(',');
  return ids.map((id, i) => ({ id, stitches: Number(st[i]) || Math.round(d.stitches / ids.length) }));
}

let dirty = false; // unsaved changes on the design page
$('#calc-form').addEventListener('input', () => (dirty = true));

function openDesignPage(d) {
  const f = $('#calc-form');
  picked = d ? pickedOf(d) : [];
  editing = d ? d.id : null;
  fillForm(f, d ? { name: d.name, heads: String(d.heads), pieces: d.pieces, metersPer1000Stitches: d.meters_per_1000, coneLengthM: d.cone_length_m } : {});
  f.querySelector('[data-save-label]').textContent = d ? 'Save changes' : 'Save design';
  $('#delete-design').hidden = !d;
  closeList();
  renderColorRows();
  showPage('design-edit', d ? d.name : 'New design', d ? `Saved ${niceDate(d.created_at)}` : 'Add the colours and their stitches; results update as you type', 'calc');
  dirty = false;
  window.scrollTo(0, 0);
  if (!d) f.elements.name.focus();
}

async function backToDesigns() {
  dirty = false;
  await loadDesigns();
  $('[data-page="calc"]').click();
}

$('#open-design-form').onclick = () => openDesignPage(null);
$('#cancel-design').onclick = async () => (await leaveDesignPage()) && backToDesigns();

$('#calc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!picked.length) return flash('Add at least one colour'), search.focus();
  try {
    await call('designs:save', { ...calcInput(), id: editing });
  } catch {
    return; // call() showed the error; stay on the page so nothing typed is lost
  }
  flash(editing ? 'Design updated' : 'Design saved', true);
  backToDesigns();
});

$('#delete-design').onclick = async () => {
  const name = $('#calc-form').elements.name.value;
  if (!(await confirmBox(`Delete design "${name}"? This cannot be undone.`))) return;
  await call('designs:delete', editing);
  flash('Design deleted', true);
  backToDesigns();
};

// Leaving the design page with unsaved changes asks first.
async function leaveDesignPage() {
  if ($('#design-edit').hidden || !dirty) return true;
  return confirmBox('You have unsaved changes. Leave without saving?', 'Leave');
}

// --- list ---
let designs = [];
async function loadDesigns() {
  designs = await call('designs:list');
  renderDesigns();
}
const idsOf = (d) => (d.color_ids ? d.color_ids.split(',').map(Number) : []);
function renderDesigns() {
  const q = $('#design-filter').value.toLowerCase();
  table(
    $('#designs'),
    ['Name', 'Colours', 'Heads', { label: 'Cones needed', num: 1 }, ''],
    designs
      .filter((d) => !q || d.name.toLowerCase().includes(q))
      .map((d) => {
        const r = JSON.parse(d.result_json || '{}');
        return `<tr data-id="${d.id}"><td><b>${esc(d.name)}</b></td>
        <td><div class="row"><span class="swatches">${idsOf(d).map((id) => swatch(colorById(id))).join('')}</span><span class="muted">${d.colors}</span></div></td>
        <td>${pill(`${d.heads} head`, d.heads === 28 ? 'purple' : 'blue', false)}</td>
        <td class="num"><b>${num(r.totalCones ?? 0)}</b></td>
        <td><div class="row-actions"><button class="btn btn-sm">${icon('open')}Open</button></div></td></tr>`;
      }),
    q ? 'No design matches your search.' : 'No designs yet. Click <b>New design</b> to add the first one.'
  );
}
$('#design-filter').oninput = renderDesigns;
// The whole row opens the design, not just the button.
$('#designs').onclick = (e) => {
  const row = e.target.closest('tr[data-id]');
  if (row) openDesignPage(designs.find((x) => x.id === Number(row.dataset.id)));
};

// ---------- stock ----------
let colors = [];
async function loadColors() {
  colors = await call('colors:list');
  $('#move-modal select').innerHTML = colors.map((c) => `<option value="${c.id}">${esc(c.code)} · ${esc(c.name)}</option>`).join('');
  const total = colors.reduce((s, c) => s + c.stock, 0);
  const low = colors.filter((c) => c.stock > 0 && c.stock < LOW_STOCK).length;
  const out = colors.filter((c) => c.stock <= 0).length;
  $('#stock-stats').innerHTML =
    statCard('blue', 'palette', 'Colours', num(colors.length), 'in the catalogue') +
    statCard('green', 'cone', 'Cones in stock', num(total), 'all colours') +
    statCard('orange', 'layers', 'Low stock', num(low), `under ${LOW_STOCK} cones`) +
    statCard('red', 'minus', 'Out of stock', num(out), 'need to order');
  renderColors();
  runCalc();
}
function stockPill(n) {
  if (n <= 0) return pill('Out of stock', 'red');
  if (n < LOW_STOCK) return pill('Low stock', 'orange');
  return pill('In stock', 'green');
}
function renderColors() {
  const q = $('#color-filter').value.toLowerCase();
  table(
    $('#colors'),
    ['', 'Code', 'Name', { label: 'Cones in stock', num: 1 }, 'Status', ''],
    colors
      .filter((c) => !q || `${c.code} ${c.name}`.toLowerCase().includes(q))
      .map((c) => `<tr data-id="${c.id}" title="Click to edit this colour"><td>${swatch(c)}</td>
        <td><b>${esc(c.code)}</b></td><td>${esc(c.name)}</td>
        <td class="num"><b>${num(c.stock)}</b></td><td>${stockPill(c.stock)}</td>
        <td><div class="row-actions">
          <button class="btn btn-sm btn-soft" data-in="${c.id}">${icon('plus')}Add</button>
          <button class="btn btn-sm" data-out="${c.id}">${icon('minus')}Use</button>
        </div></td></tr>`),
    q ? 'No colour matches your search.' : 'No colours yet. Click <b>Add colour</b> or <b>Import CSV</b>.'
  );
}
$('#color-filter').oninput = renderColors;

// Add / Use buttons record stock; a click anywhere else on the row edits the colour.
$('#colors').onclick = (e) => {
  const b = e.target.closest('button');
  const { in: inId, out: outId } = b?.dataset ?? {};
  if (inId || outId) return openModal('#move-modal', { color_id: inId || outId, dir: inId ? 'in' : 'out' }).qty.focus();
  const editColor = e.target.closest('tr[data-id]')?.dataset.id;
  if (editColor) {
    const c = colors.find((x) => x.id === Number(editColor));
    const f = openModal('#color-modal', { ...c, hex: c.hex || '#ffffff' }, `Edit colour ${c.code}`);
    f.code.readOnly = true; // code is the key; changing it would create a new colour
    f.elements.name.focus();
  }
};
$('#open-color').onclick = () => (openModal('#color-modal', {}, 'Add colour').code.readOnly = false);

onModalSubmit('#move-modal', async (d) => {
  const qty = Number(d.qty) * (d.dir === 'out' ? -1 : 1);
  await call('stock:move', { color_id: Number(d.color_id), qty, reason: d.reason });
  flash(`${Math.abs(qty)} cones ${qty > 0 ? 'added' : 'used'}`, true);
  loadColors();
});
onModalSubmit('#color-modal', async (d) => {
  await call('colors:save', d);
  flash('Colour saved', true);
  loadColors();
});
$('#import-colors').onclick = async () => {
  const n = await call('colors:import');
  if (n) flash(`Imported ${n} colours`, true), loadColors();
};

// ---------- employees ----------
const AVATAR_COLORS = ['blue', 'purple', 'green', 'orange'];
const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

let emps = [];
async function loadEmps() {
  emps = await call('employees:list');
  renderEmps();
}
function renderEmps() {
  const q = $('#emp-filter').value.toLowerCase();
  table(
    $('#emps'),
    ['Name', 'Phone', { label: 'Salary', num: 1 }, 'Status', ''],
    emps
      .filter((e) => !q || `${e.name} ${e.role} ${e.phone}`.toLowerCase().includes(q))
      .map((e) => `<tr>
      <td><div class="person"><span class="avatar soft is-${AVATAR_COLORS[e.id % AVATAR_COLORS.length]}">${esc(initials(e.name))}</span>
        <div>${esc(e.name)}<small>${esc(e.role)}</small></div></div></td>
      <td>${esc(e.phone)}</td>
      <td class="num">${e.salary == null ? '' : num(e.salary)}</td>
      <td>${e.active ? pill('Active', 'green') : pill('Left', 'grey')}</td>
      <td><div class="row-actions">
        <button class="btn btn-sm" data-edit="${e.id}">${icon('edit')}Edit</button>
        <button class="btn btn-sm btn-danger" data-del="${e.id}" aria-label="Delete">${icon('trash')}</button>
      </div></td></tr>`),
    q ? 'No employee matches your search.' : 'No employees yet. Click <b>Add employee</b> to add the first one.'
  );
}
$('#emp-filter').oninput = renderEmps;
$('#open-emp').onclick = () => openModal('#emp-modal', { active: true }, 'Add employee');

onModalSubmit('#emp-modal', async (d, f) => {
  await call('employees:save', {
    ...d,
    id: d.id ? Number(d.id) : null,
    salary: d.salary === '' ? null : Number(d.salary),
    active: f.active.checked,
  });
  flash('Employee saved', true);
  loadEmps();
});
$('#emps').onclick = async (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  const emp = emps.find((x) => x.id === Number(b.dataset.edit || b.dataset.del));
  if (b.dataset.edit) openModal('#emp-modal', emp, `Edit ${emp.name}`);
  if (b.dataset.del && (await confirmBox(`Delete ${emp.name}? This cannot be undone.`))) {
    await call('employees:delete', emp.id);
    flash('Employee deleted', true);
    loadEmps();
  }
};

// designs and the calculator need the colour list first
loadColors().then(loadDesigns);
loadEmps();
