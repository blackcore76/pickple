/* ── firebase ── */
import { initializeApp }                          from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInAnonymously }             from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, collection, addDoc, updateDoc,
  deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const fbApp = initializeApp({
  apiKey:            'AIzaSyAof2nhsCNCPeWYCmhb25kL3O5W1M8vYI8',
  authDomain:        'pickple-1c685.firebaseapp.com',
  projectId:         'pickple-1c685',
  storageBucket:     'pickple-1c685.firebasestorage.app',
  messagingSenderId: '307839955050',
  appId:             '1:307839955050:web:89b0da3057437d37b9da13',
});
const auth = getAuth(fbApp);
const db   = getFirestore(fbApp);

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
let currentUserId   = null;
let addMode         = false;
let pendingLatLng   = null;
let editingPickId   = null;
let selectedCat     = 'etc';
let activePickId    = null;

const picksMap     = new Map(); // id → pick
const pickOverlays = new Map(); // id → { overlay, el }

/* ── helpers ── */
function getCat(id) {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[6];
}

function toIso(ts) {
  if (!ts) return new Date().toISOString();
  if (ts.toDate) return ts.toDate().toISOString();
  return new Date(ts).toISOString();
}

function formatTime(iso) {
  const d   = Date.now() - new Date(iso).getTime();
  const m   = Math.floor(d / 60000);
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
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let toastTimer = null;
function showToast(type, msg) {
  const el = document.getElementById(type === 'error' ? 'errorToast' : 'successToast');
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
function addPickMarker(pick) {
  const cat   = getCat(pick.category);
  const isOwn = pick.userId === currentUserId;

  const outer = document.createElement('div');
  outer.className = 'pick-marker-outer';
  outer.innerHTML = `
    <div class="pick-marker${isOwn ? '' : ' pick-marker--others'}">${cat.icon}</div>
    <div class="pick-marker-tail${isOwn ? '' : ' pick-marker-tail--others'}"></div>
  `;
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

/* ── firebase ops ── */
async function signInUser() {
  const cred     = await signInAnonymously(auth);
  currentUserId  = cred.user.uid;
  await migrateLocalPicks();
  listenToPicks();
}

async function migrateLocalPicks() {
  const local = (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  })();
  if (!local.length) return;

  const ref = collection(db, 'picks');
  await Promise.all(local.map(p => addDoc(ref, {
    title:    p.title,
    category: p.category,
    comment:  p.comment || '',
    lat:      p.lat,
    lng:      p.lng,
    userId:   currentUserId,
    createdAt: serverTimestamp(),
  })));

  localStorage.removeItem(STORAGE_KEY);
  showToast('success', `기존 픽 ${local.length}개를 클라우드로 옮겼어요!`);
}

function listenToPicks() {
  const q = query(collection(db, 'picks'), orderBy('createdAt', 'desc'));

  onSnapshot(q, snapshot => {
    snapshot.docChanges().forEach(change => {
      const pick = {
        id:        change.doc.id,
        ...change.doc.data(),
        createdAt: toIso(change.doc.data().createdAt),
      };

      if (change.type === 'added') {
        picksMap.set(pick.id, pick);
        if (map) addPickMarker(pick);

      } else if (change.type === 'modified') {
        picksMap.set(pick.id, pick);
        removePickMarker(pick.id);
        if (map) addPickMarker(pick);
        if (activePickId === pick.id) showPickInfo(pick.id);

      } else if (change.type === 'removed') {
        picksMap.delete(pick.id);
        removePickMarker(pick.id);
        if (activePickId === pick.id) closeInfoPanel();
      }
    });
    syncEmptyHint();
  }, err => {
    console.error('Firestore:', err);
    showToast('error', '데이터 연결에 문제가 생겼어요');
  });
}

async function createPick(data) {
  await addDoc(collection(db, 'picks'), {
    ...data,
    userId:    currentUserId,
    createdAt: serverTimestamp(),
  });
}

async function updatePickData(id, updates) {
  await updateDoc(doc(db, 'picks', id), { ...updates, updatedAt: serverTimestamp() });
}

async function deletePickData(id) {
  await deleteDoc(doc(db, 'picks', id));
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
    pendingLatLng = mouseEvent.latLng;
    editingPickId = null;
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
  document.getElementById('pickTitle').value            = prefill?.title   || '';
  document.getElementById('pickComment').value          = prefill?.comment || '';
  document.getElementById('charCount').textContent      = (prefill?.comment || '').length;
  document.getElementById('modalTitle').textContent     = editingPickId ? '픽포인트 수정' : '새 픽포인트';
  document.getElementById('modalBackdrop').classList.add('show');
  setTimeout(() => document.getElementById('pickTitle').focus(), 350);
}

function openEditModal(pickId) {
  const pick = picksMap.get(pickId);
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

async function savePickFromForm() {
  const title   = document.getElementById('pickTitle').value.trim();
  const comment = document.getElementById('pickComment').value.trim();

  if (!title) {
    showToast('error', '이름을 입력해주세요');
    document.getElementById('pickTitle').focus();
    return;
  }

  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled    = true;
  saveBtn.textContent = '저장 중...';

  try {
    if (editingPickId) {
      await updatePickData(editingPickId, { title, category: selectedCat, comment });
      showToast('success', '✅ 수정됐어요!');
    } else {
      if (!pendingLatLng) return;
      await createPick({
        title, category: selectedCat, comment,
        lat: pendingLatLng.getLat(),
        lng: pendingLatLng.getLng(),
      });
      showToast('success', '📍 픽포인트 추가됐어요!');
    }
    closeModal();
  } catch {
    showToast('error', '저장에 실패했어요. 다시 시도해주세요.');
  } finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = '저장하기';
  }
}

/* ── info panel ── */
function showPickInfo(pickId) {
  const pick = picksMap.get(pickId);
  if (!pick) return;

  const cat   = getCat(pick.category);
  const isOwn = pick.userId === currentUserId;

  if (activePickId) pickOverlays.get(activePickId)?.el.classList.remove('active');
  activePickId = pickId;
  pickOverlays.get(pickId)?.el.classList.add('active');

  const actionsHtml = isOwn
    ? `<div class="pick-panel-actions">
         <button class="icon-btn" id="editPickBtn" aria-label="수정">✏️</button>
         <button class="icon-btn danger" id="deletePickBtn" aria-label="삭제">🗑️</button>
       </div>`
    : `<div class="pick-panel-badge-others">다른 픽플 유저</div>`;

  document.getElementById('panelContent').innerHTML = `
    <div class="pick-panel-header">
      <div class="pick-panel-left">
        <div class="pick-cat-badge">${cat.icon} ${cat.label}</div>
        <div class="pick-panel-title">${escapeHtml(pick.title)}</div>
      </div>
      ${actionsHtml}
    </div>
    ${pick.comment
      ? `<div class="pick-panel-comment">
           <p>${escapeHtml(pick.comment)}</p>
           <span class="pick-panel-time">${formatTime(pick.createdAt)}</span>
         </div>`
      : `<p class="no-comment">코멘트가 없어요${isOwn ? '. 수정해서 추가해보세요!' : ''}</p>`
    }
  `;

  if (isOwn) {
    document.getElementById('editPickBtn').addEventListener('click', () => openEditModal(pickId));
    document.getElementById('deletePickBtn').addEventListener('click', () => confirmDelete(pickId));
  }

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

async function confirmDelete(pickId) {
  const pick = picksMap.get(pickId);
  if (!pick || !confirm(`"${pick.title}"을(를) 삭제할까요?`)) return;
  try {
    await deletePickData(pickId);
    showToast('success', '삭제됐어요');
  } catch {
    showToast('error', '삭제에 실패했어요');
  }
}

/* ── ui ── */
function syncEmptyHint() {
  document.getElementById('emptyHint')?.classList.toggle('hide', picksMap.size > 0);
}

/* ── events ── */
document.getElementById('locationBtn').addEventListener('click', () => {
  if (!map) return;
  if (currentPosition) {
    map.panTo(new kakao.maps.LatLng(currentPosition.lat, currentPosition.lng));
  } else {
    navigator.geolocation?.getCurrentPosition(p =>
      map.panTo(new kakao.maps.LatLng(p.coords.latitude, p.coords.longitude))
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
function getPosition() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve({ lat: 37.5665, lng: 126.9780 }); return; }
    navigator.geolocation.getCurrentPosition(
      p  => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({ lat: 37.5665, lng: 126.9780 }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

async function initApp() {
  const pos = await getPosition();
  initMap(pos.lat, pos.lng);
  try {
    await signInUser();
  } catch (err) {
    console.error('Firebase init failed:', err);
    showToast('error', '서버 연결에 실패했어요. 새로고침해주세요.');
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/pickple/sw.js', { scope: '/pickple/' }).catch(() => {});
}

initApp();
