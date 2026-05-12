/* ── constants ── */
const STORAGE_KEY = 'pickple_picks';

const CATEGORIES = [
  { id: 'food',    icon: '🍜', label: '맛집'  },
  { id: 'cafe',    icon: '☕', label: '카페'  },
  { id: 'shop',    icon: '🛒', label: '쇼핑'  },
  { id: 'beauty',  icon: '💈', label: '뷰티'  },
  { id: 'health',  icon: '🏥', label: '건강'  },
  { id: 'culture', icon: '🎭', label: '문화'  },
  { id: 'etc',     icon: '📌', label: '기타'  },
];

/* ── state ── */
let map             = null;
let currentPosition = null;
let addMode         = false;
let pendingLatLng   = null;
let editingPickId   = null;
let selectedCat     = 'etc';
let activePickId    = null;

const pickOverlays  = new Map(); // id → { overlay, el }

/* ── storage ── */
function loadPicks() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function savePicks(picks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(picks));
}

function createPick(data) {
  const pick = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    createdAt: new Date().toISOString(),
    ...data,
  };
  const picks = loadPicks();
  picks.push(pick);
  savePicks(picks);
  return pick;
}

function updatePickData(id, updates) {
  const picks = loadPicks();
  const i = picks.findIndex(p => p.id === id);
  if (i === -1) return null;
  picks[i] = { ...picks[i], ...updates, updatedAt: new Date().toISOString() };
  savePicks(picks);
  return picks[i];
}

function deletePickData(id) {
  savePicks(loadPicks().filter(p => p.id !== id));
}

/* ── helpers ── */
function getCat(id) {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[6];
}

function formatTime(iso) {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1)  return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const day = Math.floor(h / 24);
  if (day < 30) return `${day}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let toastTimer = null;
function showToast(type, msg) {
  const id = type === 'error' ? 'errorToast' : 'successToast';
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

/* ── map ── */
function initMap(lat, lng) {
  map = new kakao.maps.Map(document.getElementById('map'), {
    center: new kakao.maps.LatLng(lat, lng),
    level: 4,
  });

  currentPosition = { lat, lng };
  placeCurrentLocDot(lat, lng);
  renderAllMarkers();
  syncEmptyHint();

  kakao.maps.event.addListener(map, 'click', onMapClick);
  document.getElementById('loading').classList.add('hide');
}

function placeCurrentLocDot(lat, lng) {
  const dot = document.createElement('div');
  dot.className = 'current-loc-dot';
  new kakao.maps.CustomOverlay({
    position: new kakao.maps.LatLng(lat, lng),
    content: dot,
    zIndex: 1,
  }).setMap(map);
}

/* ── markers ── */
function renderAllMarkers() {
  pickOverlays.forEach(({ overlay }) => overlay.setMap(null));
  pickOverlays.clear();
  loadPicks().forEach(p => addPickMarker(p));
}

function addPickMarker(pick) {
  const cat = getCat(pick.category);

  const outer = document.createElement('div');
  outer.className = 'pick-marker-outer';
  outer.innerHTML = `<div class="pick-marker">${cat.icon}</div><div class="pick-marker-tail"></div>`;

  outer.addEventListener('click', e => {
    e.stopPropagation();
    if (addMode) setAddMode(false);
    showPickInfo(pick.id);
  });

  const overlay = new kakao.maps.CustomOverlay({
    position: new kakao.maps.LatLng(pick.lat, pick.lng),
    content: outer,
    yAnchor: 1.15,
    zIndex: 3,
  });
  overlay.setMap(map);
  pickOverlays.set(pick.id, { overlay, el: outer });
}

function removePickMarker(id) {
  const entry = pickOverlays.get(id);
  if (entry) { entry.overlay.setMap(null); pickOverlays.delete(id); }
}

/* ── add mode ── */
function setAddMode(active) {
  addMode = active;
  document.getElementById('addBtn').classList.toggle('active', active);
  document.getElementById('modeBanner').classList.toggle('show', active);
  if (active) closeInfoPanel();
}

function onMapClick(mouseEvent) {
  if (addMode) {
    pendingLatLng  = mouseEvent.latLng;
    editingPickId  = null;
    setAddMode(false);
    openModal();
  } else {
    closeInfoPanel();
  }
}

/* ── modal ── */
function openModal(prefill) {
  selectedCat = prefill?.category || 'etc';
  renderCategoryGrid();
  document.getElementById('pickTitle').value   = prefill?.title || '';
  document.getElementById('pickComment').value  = prefill?.comment || '';
  document.getElementById('charCount').textContent = (prefill?.comment || '').length;
  document.getElementById('modalTitle').textContent = editingPickId ? '픽포인트 수정' : '새 픽포인트';
  document.getElementById('modalBackdrop').classList.add('show');
  setTimeout(() => document.getElementById('pickTitle').focus(), 350);
}

function openEditModal(pickId) {
  const pick = loadPicks().find(p => p.id === pickId);
  if (!pick) return;
  editingPickId = pickId;
  closeInfoPanel();
  openModal(pick);
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('show');
  editingPickId = null;
  pendingLatLng = null;
}

function renderCategoryGrid() {
  document.getElementById('categoryGrid').innerHTML = CATEGORIES.map(cat => `
    <button class="cat-btn${cat.id === selectedCat ? ' selected' : ''}" data-id="${cat.id}" type="button">
      ${cat.icon}<span>${cat.label}</span>
    </button>
  `).join('');
}

function savePickFromForm() {
  const title   = document.getElementById('pickTitle').value.trim();
  const comment = document.getElementById('pickComment').value.trim();

  if (!title) {
    showToast('error', '이름을 입력해주세요');
    document.getElementById('pickTitle').focus();
    return;
  }

  if (editingPickId) {
    const updated = updatePickData(editingPickId, { title, category: selectedCat, comment });
    if (updated) {
      removePickMarker(editingPickId);
      addPickMarker(updated);
      showToast('success', '✅ 수정됐어요!');
    }
  } else {
    if (!pendingLatLng) return;
    const pick = createPick({
      title, category: selectedCat, comment,
      lat: pendingLatLng.getLat(),
      lng: pendingLatLng.getLng(),
    });
    addPickMarker(pick);
    showToast('success', '📍 픽포인트 추가됐어요!');
  }

  closeModal();
  syncEmptyHint();
}

/* ── info panel ── */
function showPickInfo(pickId) {
  const pick = loadPicks().find(p => p.id === pickId);
  if (!pick) return;

  const cat = getCat(pick.category);

  if (activePickId) pickOverlays.get(activePickId)?.el.classList.remove('active');
  activePickId = pickId;
  pickOverlays.get(pickId)?.el.classList.add('active');

  document.getElementById('panelContent').innerHTML = `
    <div class="pick-panel-header">
      <div class="pick-panel-left">
        <div class="pick-cat-badge">${cat.icon} ${cat.label}</div>
        <div class="pick-panel-title">${escapeHtml(pick.title)}</div>
      </div>
      <div class="pick-panel-actions">
        <button class="icon-btn" id="editPickBtn" aria-label="수정">✏️</button>
        <button class="icon-btn danger" id="deletePickBtn" aria-label="삭제">🗑️</button>
      </div>
    </div>
    ${pick.comment
      ? `<div class="pick-panel-comment">
           <p>${escapeHtml(pick.comment)}</p>
           <span class="pick-panel-time">${formatTime(pick.createdAt)}</span>
         </div>`
      : `<p class="no-comment">코멘트가 없어요. 수정해서 추가해보세요!</p>`
    }
  `;

  document.getElementById('editPickBtn').addEventListener('click', () => openEditModal(pickId));
  document.getElementById('deletePickBtn').addEventListener('click', () => confirmDelete(pickId));

  document.getElementById('infoPanel').classList.add('show');
  map.panTo(new kakao.maps.LatLng(pick.lat, pick.lng));
}

function closeInfoPanel() {
  document.getElementById('infoPanel').classList.remove('show');
  if (activePickId) {
    pickOverlays.get(activePickId)?.el.classList.remove('active');
    activePickId = null;
  }
}

function confirmDelete(pickId) {
  const pick = loadPicks().find(p => p.id === pickId);
  if (!pick) return;
  if (!confirm(`"${pick.title}"을(를) 삭제할까요?`)) return;
  deletePickData(pickId);
  removePickMarker(pickId);
  closeInfoPanel();
  showToast('success', '삭제됐어요');
  syncEmptyHint();
}

/* ── empty hint ── */
function syncEmptyHint() {
  const el = document.getElementById('emptyHint');
  if (!el) return;
  if (loadPicks().length === 0) {
    el.classList.remove('hide');
  } else {
    el.classList.add('hide');
  }
}

/* ── event wiring ── */
document.getElementById('locationBtn').addEventListener('click', () => {
  if (!map) return;
  if (currentPosition) {
    map.panTo(new kakao.maps.LatLng(currentPosition.lat, currentPosition.lng));
  } else {
    navigator.geolocation?.getCurrentPosition(pos =>
      map.panTo(new kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude))
    );
  }
});

document.getElementById('addBtn').addEventListener('click', () => setAddMode(!addMode));

document.getElementById('cancelAddMode').addEventListener('click', () => setAddMode(false));

document.getElementById('panelHandle').addEventListener('click', closeInfoPanel);

document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('cancelBtn').addEventListener('click', closeModal);
document.getElementById('saveBtn').addEventListener('click', savePickFromForm);

document.getElementById('modalBackdrop').addEventListener('click', e => {
  if (e.target === document.getElementById('modalBackdrop')) closeModal();
});

document.getElementById('categoryGrid').addEventListener('click', e => {
  const btn = e.target.closest('.cat-btn');
  if (!btn) return;
  selectedCat = btn.dataset.id;
  renderCategoryGrid();
});

document.getElementById('pickComment').addEventListener('input', () => {
  document.getElementById('charCount').textContent =
    document.getElementById('pickComment').value.length;
});

document.getElementById('pickTitle').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('pickComment').focus(); }
});

/* ── init ── */
function initApp() {
  if (!navigator.geolocation) {
    initMap(37.5665, 126.9780);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => initMap(pos.coords.latitude, pos.coords.longitude),
    ()  => {
      showToast('error', '위치 정보를 가져올 수 없어요');
      initMap(37.5665, 126.9780);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/pickple/sw.js', { scope: '/pickple/' })
    .catch(() => {});
}

initApp();
