const BACKEND_BASE_URL = 'http://localhost:8080/api/map';
const FAVORITES_STORAGE_KEY = 'brisa_favorite_places_v1';

const container = document.getElementById('map');
const options = {
    center: new kakao.maps.LatLng(37.497942, 127.027621),
    level: 3
};

const map = new kakao.maps.Map(container, options);

const markerPosition = new kakao.maps.LatLng(37.497942, 127.027621);
const marker = new kakao.maps.Marker({
    position: markerPosition
});
marker.setMap(map);

const ps = new kakao.maps.services.Places();
const infowindow = new kakao.maps.InfoWindow({ zIndex: 1 });

function searchPlace() {
    const keyword = document.getElementById('keyword').value.trim();
    if (!keyword) {
        alert('검색할 지역이나 주소를 입력해주세요.');
        return;
    }

    ps.keywordSearch(keyword, function(data, status) {
        if (status === kakao.maps.services.Status.OK) {
            const firstPlace = data[0];
            const moveLatLon = new kakao.maps.LatLng(firstPlace.y, firstPlace.x);

            marker.setPosition(moveLatLon);
            map.setCenter(moveLatLon);

            infowindow.setContent(`<div class="iw-box">${escapeHtml(firstPlace.place_name)}</div>`);
            infowindow.open(map, marker);
        } else if (status === kakao.maps.services.Status.ZERO_RESULT) {
            alert('검색 결과가 없습니다.');
        } else {
            alert('검색 중 오류가 발생했습니다.');
        }
    });
}

// ==================== 사이드바 및 다중 인원 / 대중교통 균등 상권 분석 스크립트 ====================
let meetingPurpose = 'DINING';
let members = [
    { id: 1, keyword: '', placeName: '', lat: null, lng: null, marker: null },
    { id: 2, keyword: '', placeName: '', lat: null, lng: null, marker: null }
];
let memberSeq = 3;

let radiusCircle = null;
let recommendMarkers = [];
let currentCategorizedGroups = [];
let currentSelectedAreaName = '';
let activeCategoryFilter = 'ALL';

let selectedPlaceMarker = null;
let highlightedPinMarker = null;
let selectedPlaceOverlay = null;
let selectedPlaceContext = null;

// ==================== 즐겨찾기 상태 및 전용 마커 필터 관리 ====================
let favoritePlaces = loadFavoritesFromStorage();
let selectedFavoriteIds = new Set();

let isFavoritesOnlyMode = false;
let favoriteOnlyMarkers = [];
let favoriteOnlyOverlays = [];

// 즐겨찾기 전용 황금색 별 핀 마커 이미지
const FAV_ONLY_MARKER_SVG =
    'data:image/svg+xml;charset=UTF-8,' +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="38" height="48" viewBox="0 0 38 48">' +
        '<defs><filter id="fs" x="-20%" y="-10%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.35"/></filter></defs>' +
        '<path filter="url(#fs)" d="M19 1C9.6 1 2 8.6 2 18c0 11.8 17 27 17 27s17-15.2 17-27C36 8.6 28.4 1 19 1z" fill="#f59e0b" stroke="#ffffff" stroke-width="2.5"/>' +
        '<polygon points="19,8 21.8,13.7 28,14.6 23.5,19 24.6,25.2 19,22.2 13.4,25.2 14.5,19 10,14.6 16.2,13.7" fill="#ffffff"/>' +
        '</svg>'
    );
const favOnlyMarkerImage = new kakao.maps.MarkerImage(
    FAV_ONLY_MARKER_SVG,
    new kakao.maps.Size(38, 48),
    { offset: new kakao.maps.Point(19, 46) }
);

function loadFavoritesFromStorage() {
    try {
        const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function saveFavoritesToStorage() {
    try {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoritePlaces));
    } catch (e) {
        // 스토리지 용량 초과 등 예외 무시
    }
}

function isPlaceFavorited(placeId) {
    return favoritePlaces.some(f => String(f.id) === String(placeId));
}

function clearFavoriteOnlyMarkersOnMap() {
    favoriteOnlyMarkers.forEach(mk => mk.setMap(null));
    favoriteOnlyMarkers = [];
    favoriteOnlyOverlays.forEach(ov => ov.setMap(null));
    favoriteOnlyOverlays = [];
}

/**
 * 지도 위 마커 표시 모드 동기화:
 * isFavoritesOnlyMode === true -> 일반 추천 마커 숨김 + 즐겨찾기 장소만 전용 마커 표시
 * isFavoritesOnlyMode === false -> 즐겨찾기 전용 마커 제거 + 일반 추천 마커 복원
 */
function syncMapMarkersByFavoriteMode(fitBounds = false) {
    const favOnlyBtn = document.getElementById('btnToggleFavOnly');
    if (favOnlyBtn) {
        favOnlyBtn.classList.toggle('active', isFavoritesOnlyMode);
        favOnlyBtn.textContent = isFavoritesOnlyMode ? '⭐ 전체 마커 복원' : '⭐ 즐겨찾기만 보기';
    }

    clearFavoriteOnlyMarkersOnMap();

    if (isFavoritesOnlyMode) {
        recommendMarkers.forEach(rm => rm.setMap(null));
        if (selectedPlaceMarker) {
            selectedPlaceMarker.setMap(null);
        }

        const bounds = new kakao.maps.LatLngBounds();

        favoritePlaces.forEach((fav, idx) => {
            const pos = new kakao.maps.LatLng(parseFloat(fav.y), parseFloat(fav.x));
            bounds.extend(pos);

            const fMarker = new kakao.maps.Marker({
                map: map,
                position: pos,
                image: favOnlyMarkerImage,
                title: `★ ${fav.place_name}`,
                zIndex: 9
            });
            kakao.maps.event.addListener(fMarker, 'click', () => {
                openPlaceDetail(fav, { title: fav.themeTitle || '즐겨찾기 장소' }, null, null);
            });
            favoriteOnlyMarkers.push(fMarker);

            const labelOv = new kakao.maps.CustomOverlay({
                position: pos,
                content: `<div class="fav-only-marker-label">★ ${idx + 1}. ${escapeHtml(fav.place_name)}</div>`,
                yAnchor: 1,
                zIndex: 10
            });
            labelOv.setMap(map);
            favoriteOnlyOverlays.push(labelOv);
        });

        if (fitBounds && favoritePlaces.length > 0) {
            if (favoritePlaces.length === 1) {
                map.setCenter(new kakao.maps.LatLng(parseFloat(favoritePlaces[0].y), parseFloat(favoritePlaces[0].x)));
                if (map.getLevel() > 3) map.setLevel(3);
            } else {
                map.setBounds(bounds);
            }
        }
    } else {
        recommendMarkers.forEach(rm => {
            if (rm !== selectedPlaceMarker) {
                rm.setMap(map);
            }
        });
    }
}

function toggleFavoritesOnlyOnMap() {
    if (!isFavoritesOnlyMode && favoritePlaces.length === 0) {
        alert('먼저 즐겨찾기에 장소를 1곳 이상 저장해 주세요.');
        return;
    }
    isFavoritesOnlyMode = !isFavoritesOnlyMode;
    syncMapMarkersByFavoriteMode(isFavoritesOnlyMode);
}

function toggleFavoritePlace(place, groupTitle) {
    if (!place || !place.id) return;
    const targetId = String(place.id);
    const exists = isPlaceFavorited(targetId);

    if (exists) {
        favoritePlaces = favoritePlaces.filter(f => String(f.id) !== targetId);
        selectedFavoriteIds.delete(targetId);
    } else {
        favoritePlaces.push({
            id: targetId,
            place_name: place.place_name || '',
            category_name: place.category_name || '',
            road_address_name: place.road_address_name || '',
            address_name: place.address_name || '',
            phone: place.phone || '',
            x: String(place.x),
            y: String(place.y),
            distance: place.distance || '',
            place_url: place.place_url || '',
            themeTitle: groupTitle || '추천 장소'
        });
    }

    saveFavoritesToStorage();
    renderFavoritesBox();
    syncFavoriteStarButtons();
}

function removeSingleFavorite(placeId) {
    const targetId = String(placeId);
    favoritePlaces = favoritePlaces.filter(f => String(f.id) !== targetId);
    selectedFavoriteIds.delete(targetId);
    saveFavoritesToStorage();
    renderFavoritesBox();
    syncFavoriteStarButtons();
}

function toggleFavoriteCheckbox(placeId, checked) {
    const targetId = String(placeId);
    if (checked) {
        selectedFavoriteIds.add(targetId);
    } else {
        selectedFavoriteIds.delete(targetId);
    }
}

function toggleSelectAllFavorites() {
    if (favoritePlaces.length === 0) return;
    if (selectedFavoriteIds.size === favoritePlaces.length) {
        selectedFavoriteIds.clear();
    } else {
        favoritePlaces.forEach(f => selectedFavoriteIds.add(String(f.id)));
    }
    renderFavoritesBox();
}

function removeSelectedFavorites() {
    if (selectedFavoriteIds.size === 0) {
        alert('삭제할 즐겨찾기 장소를 체크박스로 선택해 주세요.');
        return;
    }
    favoritePlaces = favoritePlaces.filter(f => !selectedFavoriteIds.has(String(f.id)));
    selectedFavoriteIds.clear();
    saveFavoritesToStorage();
    renderFavoritesBox();
    syncFavoriteStarButtons();
}

function renderFavoritesBox() {
    const countBadge = document.getElementById('favCountBadge');
    const listArea = document.getElementById('favoriteListArea');

    if (countBadge) countBadge.textContent = favoritePlaces.length;
    if (!listArea) return;

    if (favoritePlaces.length === 0) {
        isFavoritesOnlyMode = false;
        syncMapMarkersByFavoriteMode(false);
        listArea.innerHTML = '저장된 즐겨찾기 장소가 없습니다.';
        return;
    }

    listArea.innerHTML = '';

    favoritePlaces.forEach((fav, idx) => {
        const isChecked = selectedFavoriteIds.has(String(fav.id));
        const row = document.createElement('div');
        row.className = 'fav-item';

        row.innerHTML = `
            <input type="checkbox" class="fav-item-chk" ${isChecked ? 'checked' : ''} aria-label="즐겨찾기 선택">
            <div class="fav-item-body">
                <div>
                    <span class="fav-theme-tag">${idx + 1}</span>
                    <strong style="color:#0f172a;">${escapeHtml(fav.place_name)}</strong>
                </div>
                <div style="color:#64748b;font-size:11px;margin-top:3px;">${escapeHtml(fav.road_address_name || fav.address_name || '')}</div>
            </div>
            <button type="button" class="fav-item-del">삭제</button>
        `;

        const chk = row.querySelector('.fav-item-chk');
        chk.addEventListener('change', (e) => {
            toggleFavoriteCheckbox(fav.id, e.target.checked);
        });

        const bodyEl = row.querySelector('.fav-item-body');
        bodyEl.addEventListener('click', () => {
            openPlaceDetail(fav, { title: fav.themeTitle || '즐겨찾기 장소' }, null, null);
        });

        const delBtn = row.querySelector('.fav-item-del');
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeSingleFavorite(fav.id);
        });

        listArea.appendChild(row);
    });

    if (isFavoritesOnlyMode) {
        syncMapMarkersByFavoriteMode(false);
    }
}

function syncFavoriteStarButtons() {
    document.querySelectorAll('.rec-star-btn').forEach(btn => {
        const pid = btn.dataset.placeId;
        const saved = isPlaceFavorited(pid);
        btn.classList.toggle('saved', saved);
        btn.textContent = saved ? '★' : '☆';
        btn.title = saved ? '즐겨찾기 해제' : '즐겨찾기 저장';
    });

    const modalBtn = document.getElementById('pmFavToggleBtn');
    if (modalBtn && selectedPlaceContext && selectedPlaceContext.place) {
        const saved = isPlaceFavorited(selectedPlaceContext.place.id);
        modalBtn.classList.toggle('saved', saved);
        modalBtn.textContent = saved ? '★ 저장됨' : '☆ 즐겨찾기';
    }
}

// 선택된 가게 강조 마커 이미지 (SVG Data URI)
const HIGHLIGHTED_MARKER_SVG =
    'data:image/svg+xml;charset=UTF-8,' +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="50" viewBox="0 0 40 50">' +
        '<defs><filter id="s" x="-20%" y="-10%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.35"/></filter></defs>' +
        '<path filter="url(#s)" d="M20 2C10.6 2 3 9.6 3 19c0 12.2 17 28 17 28s17-15.8 17-28C37 9.6 29.4 2 20 2z" fill="#ef4444" stroke="#ffffff" stroke-width="2.5"/>' +
        '<circle cx="20" cy="18.5" r="6.5" fill="#ffffff"/>' +
        '<circle cx="20" cy="18.5" r="3" fill="#ef4444"/>' +
        '</svg>'
    );
const highlightedMarkerImage = new kakao.maps.MarkerImage(
    HIGHLIGHTED_MARKER_SVG,
    new kakao.maps.Size(40, 50),
    { offset: new kakao.maps.Point(20, 48) }
);

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function clearHighlightedPlaceMarker() {
    if (highlightedPinMarker) {
        highlightedPinMarker.setMap(null);
        highlightedPinMarker = null;
    }
    if (selectedPlaceMarker) {
        if (!isFavoritesOnlyMode) {
            selectedPlaceMarker.setMap(map);
        }
        selectedPlaceMarker = null;
    }
    if (selectedPlaceOverlay) {
        selectedPlaceOverlay.setMap(null);
        selectedPlaceOverlay = null;
    }
}

function highlightPlaceMarker(place, rMarker) {
    clearHighlightedPlaceMarker();

    const pPos = new kakao.maps.LatLng(place.y, place.x);
    if (rMarker) {
        rMarker.setMap(null);
        selectedPlaceMarker = rMarker;
    }

    highlightedPinMarker = new kakao.maps.Marker({
        map: map,
        position: pPos,
        image: highlightedMarkerImage,
        title: place.place_name,
        zIndex: 10
    });
    kakao.maps.event.addListener(highlightedPinMarker, 'click', reopenSelectedPlaceModal);

    infowindow.close();

    selectedPlaceOverlay = new kakao.maps.CustomOverlay({
        position: pPos,
        content: `<div class="highlighted-marker-label">📍 ${escapeHtml(place.place_name)}</div>`,
        yAnchor: 1,
        zIndex: 11
    });
    selectedPlaceOverlay.setMap(map);

    if (map.getLevel() > 4) {
        map.setLevel(3, { animate: { duration: 250 } });
    }
    map.panTo(pPos);
}

function copyTextToClipboard(text, btnEl) {
    if (!text) return;
    const onSuccess = () => {
        if (!btnEl) return;
        const prev = btnEl.textContent;
        btnEl.textContent = '복사됨 ✓';
        setTimeout(() => { btnEl.textContent = prev; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(onSuccess).catch(() => {});
    }
}

function buildExternalMapLinks(place) {
    const placeName = place.place_name || '';
    const addressBase = (place.road_address_name || place.address_name || '').split(/\s+/).slice(0, 2).join(' ');
    const kakaoDetailUrl = place.place_url || `https://map.kakao.com/link/search/${encodeURIComponent(placeName)}`;
    const kakaoDirectionsUrl = `https://map.kakao.com/link/to/${encodeURIComponent(placeName)},${place.y},${place.x}`;
    const naverSearchQuery = [placeName, addressBase].filter(Boolean).join(' ');
    const naverReviewUrl = `https://map.naver.com/p/search/${encodeURIComponent(naverSearchQuery)}`;
    const naverDirectionsUrl = `https://map.naver.com/p/directions/-/${place.x},${place.y},${encodeURIComponent(placeName)}/-/transit`;

    return {
        kakaoDetailUrl,
        kakaoDirectionsUrl,
        naverReviewUrl,
        naverDirectionsUrl
    };
}

function reopenSelectedPlaceModal() {
    if (!selectedPlaceContext) return;
    const { place, group, marker, itemDiv } = selectedPlaceContext;
    openPlaceDetail(place, group, marker, itemDiv);
}

function openPlaceDetail(place, group, rMarker, itemDiv) {
    selectedPlaceContext = { place, group, marker: rMarker, itemDiv };

    document.querySelectorAll('.rec-item').forEach(el => el.classList.remove('active'));
    if (itemDiv) {
        itemDiv.classList.add('active');
        itemDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    highlightPlaceMarker(place, rMarker);

    const roadAddr = place.road_address_name || '';
    const jibunAddr = place.address_name || '';
    const primaryAddr = roadAddr || jibunAddr || '주소 정보 없음';
    const phone = place.phone || '';
    const distanceMeters = Number(place.distance);
    const hasDistance = !Number.isNaN(distanceMeters) && place.distance !== '' && place.distance !== undefined;
    const walkMinutes = hasDistance ? Math.max(1, Math.round(distanceMeters / 67)) : null;
    const links = buildExternalMapLinks(place);

    const detailArea = document.getElementById('placeDetailArea');
    if (detailArea) {
        detailArea.innerHTML = `
            <div><b>테마 분류:</b> ${escapeHtml(group.title)}</div>
            <div><b>상호명:</b> ${escapeHtml(place.place_name)}</div>
            <div><b>카테고리:</b> ${escapeHtml(place.category_name || '정보 없음')}</div>
            <div><b>주소:</b> ${escapeHtml(primaryAddr)}</div>
            <div><b>전화:</b> ${phone ? escapeHtml(phone) : '정보 없음'}</div>
            <div><b>거리:</b> ${hasDistance ? `${escapeHtml(currentSelectedAreaName)}에서 ${distanceMeters}m (도보 약 ${walkMinutes}분)` : '거리 정보 없음'}</div>
            <button type="button" class="pm-btn-reopen" onclick="reopenSelectedPlaceModal()">상세 정보 창 크게 보기</button>
        `;
    }

    document.getElementById('pmThemeBadge').textContent = group.title || '추천 장소';
    document.getElementById('pmTitle').textContent = place.place_name || '이름 없음';
    document.getElementById('pmCategorySub').textContent = place.category_name || '카테고리 정보 없음';

    const pmFavBtn = document.getElementById('pmFavToggleBtn');
    if (pmFavBtn) {
        const saved = isPlaceFavorited(place.id);
        pmFavBtn.classList.toggle('saved', saved);
        pmFavBtn.textContent = saved ? '★ 저장됨' : '☆ 즐겨찾기';
        pmFavBtn.onclick = () => toggleFavoritePlace(place, group.title);
    }

    const basicInfoEl = document.getElementById('pmBasicInfo');
    basicInfoEl.innerHTML = `
        <div class="pm-info-row">
            <span class="pm-info-label">📍 주소</span>
            <div class="pm-info-val">
                <div>
                    <span>${escapeHtml(primaryAddr)}</span>
                    ${primaryAddr !== '주소 정보 없음' ? `<button type="button" class="pm-copy-btn" id="pmCopyAddrBtn">복사</button>` : ''}
                </div>
                ${(roadAddr && jibunAddr) ? `<div class="pm-sub-addr">(지번) ${escapeHtml(jibunAddr)}</div>` : ''}
            </div>
        </div>
        <div class="pm-info-row">
            <span class="pm-info-label">📞 전화번호</span>
            <div class="pm-info-val">
                ${phone
        ? `<a href="tel:${escapeHtml(phone)}" style="color:#2563eb;font-weight:bold;text-decoration:none;">${escapeHtml(phone)}</a>`
        : '<span style="color:#94a3b8;">등록된 전화번호 없음</span>'}
            </div>
        </div>
        <div class="pm-info-row">
            <span class="pm-info-label">🚶 거리</span>
            <div class="pm-info-val">
                ${hasDistance
        ? `<span class="pm-dist-badge">${escapeHtml(currentSelectedAreaName || '중심지')}에서 ${distanceMeters}m · 도보 약 ${walkMinutes}분</span>`
        : '<span style="color:#94a3b8;">거리 정보 없음</span>'}
            </div>
        </div>
    `;

    const copyBtn = document.getElementById('pmCopyAddrBtn');
    if (copyBtn) {
        copyBtn.onclick = () => copyTextToClipboard(primaryAddr, copyBtn);
    }

    document.getElementById('pmActionsGrid').innerHTML = `
        <a class="pm-link-btn pm-btn-kakao" href="${escapeHtml(links.kakaoDetailUrl)}" target="_blank" rel="noopener noreferrer">💬 카카오맵 리뷰 · 상세</a>
        <a class="pm-link-btn pm-btn-kakao-outline" href="${escapeHtml(links.kakaoDirectionsUrl)}" target="_blank" rel="noopener noreferrer">🧭 카카오맵 길찾기</a>
        <a class="pm-link-btn pm-btn-naver" href="${escapeHtml(links.naverReviewUrl)}" target="_blank" rel="noopener noreferrer">🔍 네이버지도 리뷰 · 검색</a>
        <a class="pm-link-btn pm-btn-naver-outline" href="${escapeHtml(links.naverDirectionsUrl)}" target="_blank" rel="noopener noreferrer">🚇 네이버지도 길찾기</a>
    `;

    document.getElementById('placeDetailModalOverlay').classList.add('open');
}

function closePlaceDetailModal() {
    const overlay = document.getElementById('placeDetailModalOverlay');
    if (overlay) {
        overlay.classList.remove('open');
    }
}

function handleModalOverlayClick(event) {
    if (event.target && event.target.id === 'placeDetailModalOverlay') {
        closePlaceDetailModal();
    }
}

document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closePlaceDetailModal();
    }
});

function toggleSidebar(id, btn) {
    const el = document.getElementById(id);
    el.classList.toggle('collapsed');
    const collapsed = el.classList.contains('collapsed');
    if (id === 'leftSidebar') {
        btn.textContent = collapsed ? '▶' : '◀';
    } else {
        btn.textContent = collapsed ? '◀' : '▶';
    }
}

function selectPurpose(el) {
    document.querySelectorAll('.purpose-item').forEach(item => item.classList.remove('active'));
    el.classList.add('active');
    meetingPurpose = el.dataset.type;
}

function renderMembers() {
    document.getElementById('nCountText').textContent = members.length;
    document.getElementById('nCountBox').textContent = members.length;

    const area = document.getElementById('memberListArea');
    area.innerHTML = '';

    members.forEach((m, index) => {
        const card = document.createElement('div');
        card.className = 'member-card';
        card.innerHTML = `
            <div class="member-card-head">
                <span>인원 ${index + 1}</span>
                ${members.length > 2 ? `<button type="button" class="btn-del" onclick="removeMember(${m.id})">삭제</button>` : ''}
            </div>
            <div class="member-input-row">
                <input type="text" id="member-input-${m.id}" value="${escapeHtml(m.keyword)}" placeholder="출발지 입력 (역, 동, 주소)"
                       onkeypress="if(event.key==='Enter') searchMemberPlace(${m.id})">
                <button type="button" class="btn-yellow" onclick="searchMemberPlace(${m.id})">검색</button>
            </div>
            <div class="member-coord">
                ${m.lat ? `✔ ${escapeHtml(m.placeName)} (${m.lat.toFixed(4)}, ${m.lng.toFixed(4)})` : '<span style="color:#999;">미지정</span>'}
            </div>
        `;
        area.appendChild(card);
    });
}

function addMember() {
    members.push({ id: memberSeq++, keyword: '', placeName: '', lat: null, lng: null, marker: null });
    renderMembers();
}

function removeMember(id) {
    if (members.length <= 2) return;
    const target = members.find(m => m.id === id);
    if (target && target.marker) target.marker.setMap(null);
    members = members.filter(m => m.id !== id);
    renderMembers();
}

function updateMemberCount(diff) {
    if (diff > 0) {
        addMember();
    } else if (diff < 0 && members.length > 2) {
        removeMember(members[members.length - 1].id);
    }
}

function searchMemberPlace(id) {
    const val = document.getElementById(`member-input-${id}`).value.trim();
    if (!val) {
        alert('출발지를 입력해주세요.');
        return;
    }
    const member = members.find(m => m.id === id);
    member.keyword = val;

    ps.keywordSearch(val, function(data, status) {
        if (status === kakao.maps.services.Status.OK) {
            const place = data[0];
            const lat = parseFloat(place.y);
            const lng = parseFloat(place.x);
            const pos = new kakao.maps.LatLng(lat, lng);

            member.lat = lat;
            member.lng = lng;
            member.placeName = place.place_name;

            if (member.marker) member.marker.setMap(null);
            member.marker = new kakao.maps.Marker({
                map: map,
                position: pos,
                title: place.place_name
            });

            map.setCenter(pos);
            renderMembers();
        } else {
            alert('검색 결과가 없습니다.');
        }
    });
}

function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function estimateTransitMinutes(startLat, startLng, endLat, endLng) {
    const distKm = getDistanceKm(startLat, startLng, endLat, endLng);
    return Math.max(8, Math.round((distKm / 25) * 60 + 10));
}

function searchCategoryPromise(code, location, radius) {
    return new Promise((resolve) => {
        let allPlaces = [];
        ps.categorySearch(code, function(data, status, pagination) {
            if (status === kakao.maps.services.Status.OK) {
                allPlaces = allPlaces.concat(data);
                if (pagination.hasNextPage) {
                    pagination.nextPage();
                } else {
                    resolve({ places: allPlaces, totalCount: allPlaces.length });
                }
            } else {
                resolve({ places: allPlaces, totalCount: allPlaces.length });
            }
        }, { location: location, radius: radius });
    });
}

function searchKeywordPromise(keyword, location, radius) {
    return new Promise((resolve) => {
        let allPlaces = [];
        ps.keywordSearch(keyword, function(data, status, pagination) {
            if (status === kakao.maps.services.Status.OK) {
                allPlaces = allPlaces.concat(data);
                if (pagination.hasNextPage) {
                    pagination.nextPage();
                } else {
                    resolve({ places: allPlaces, totalCount: allPlaces.length });
                }
            } else {
                resolve({ places: allPlaces, totalCount: allPlaces.length });
            }
        }, { location: location, radius: radius, sort: kakao.maps.services.SortBy.DISTANCE });
    });
}

async function runTasksInBatches(taskFns, batchSize = 5) {
    const results = [];
    for (let i = 0; i < taskFns.length; i += batchSize) {
        const batch = taskFns.slice(i, i + batchSize).map(fn => fn());
        const batchRes = await Promise.all(batch);
        results.push(...batchRes);
    }
    return results;
}

function prepareAllPlaces(places) {
    const seen = new Set();
    return places
        .filter(p => {
            if (seen.has(p.id)) return false;
            seen.add(p.id);
            return true;
        })
        .sort((a, b) => Number(a.distance) - Number(b.distance));
}

function renderCategorizedRecommendations(filterKey = 'ALL') {
    activeCategoryFilter = filterKey;

    clearHighlightedPlaceMarker();
    recommendMarkers.forEach(rm => rm.setMap(null));
    recommendMarkers = [];

    const filterBar = document.getElementById('categoryFilterBar');
    const listArea = document.getElementById('recommendListArea');

    const nonEmptyGroups = currentCategorizedGroups.filter(g => g.places.length > 0);

    if (nonEmptyGroups.length === 0) {
        filterBar.innerHTML = '';
        listArea.innerHTML = '선정된 상권 반경 내 조건에 맞는 장소가 없습니다.';
        return;
    }

    if (nonEmptyGroups.length > 1) {
        const totalItems = nonEmptyGroups.reduce((sum, g) => sum + g.places.length, 0);
        let tabsHtml = `<button type="button" class="cat-tab ${filterKey === 'ALL' ? 'active' : ''}" onclick="renderCategorizedRecommendations('ALL')">전체 (${totalItems})</button>`;
        nonEmptyGroups.forEach(g => {
            tabsHtml += `<button type="button" class="cat-tab ${filterKey === g.key ? 'active' : ''}" onclick="renderCategorizedRecommendations('${g.key}')">${g.shortLabel} (${g.places.length})</button>`;
        });
        filterBar.innerHTML = tabsHtml;
    } else {
        filterBar.innerHTML = '';
    }

    listArea.innerHTML = '';
    const targetGroups = (filterKey === 'ALL')
        ? nonEmptyGroups
        : nonEmptyGroups.filter(g => g.key === filterKey);

    targetGroups.forEach(group => {
        const section = document.createElement('div');
        section.className = 'cat-section';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'cat-section-title';
        titleDiv.innerHTML = `<span>${group.title}</span><span style="color:#2563eb;">${group.places.length}곳</span>`;
        section.appendChild(titleDiv);

        group.places.forEach((p, idx) => {
            const pPos = new kakao.maps.LatLng(p.y, p.x);
            const rMarker = new kakao.maps.Marker({
                map: isFavoritesOnlyMode ? null : map,
                position: pPos,
                title: p.place_name
            });
            recommendMarkers.push(rMarker);

            const subCategory = (p.category_name || '').split('>').pop().trim() || '기타';
            const saved = isPlaceFavorited(p.id);
            const itemDiv = document.createElement('div');
            itemDiv.className = 'rec-item';
            itemDiv.innerHTML = `
                <div style="min-width:0;flex:1;">
                    <strong>${idx + 1}. ${escapeHtml(p.place_name)}</strong><br>
                    <span style="color:#666;font-size:11px;">${escapeHtml(subCategory)} · 중심역에서 ${escapeHtml(p.distance)}m</span>
                </div>
                <button type="button" class="rec-star-btn ${saved ? 'saved' : ''}" data-place-id="${escapeHtml(p.id)}" title="${saved ? '즐겨찾기 해제' : '즐겨찾기 저장'}">${saved ? '★' : '☆'}</button>
            `;

            const handleSelectPlace = function() {
                openPlaceDetail(p, group, rMarker, itemDiv);
            };

            const starBtn = itemDiv.querySelector('.rec-star-btn');
            starBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleFavoritePlace(p, group.title);
            });

            itemDiv.onclick = handleSelectPlace;
            kakao.maps.event.addListener(rMarker, 'click', handleSelectPlace);
            section.appendChild(itemDiv);
        });

        listArea.appendChild(section);
    });

    if (isFavoritesOnlyMode) {
        syncMapMarkersByFavoriteMode(false);
    }
}

async function calculateMeetingSpot() {
    const validMembers = members.filter(m => m.lat !== null && m.lng !== null);
    if (validMembers.length < 2) {
        alert('최소 2명 이상의 출발지를 검색해 지정해주세요.');
        return;
    }

    const listArea = document.getElementById('recommendListArea');
    listArea.innerHTML = '<div style="color:#2563eb;font-weight:bold;">중심 상권 및 카테고리별 전체 장소를 분석 중입니다...</div>';

    let selectedLat = null;
    let selectedLng = null;
    let selectedAreaName = '';
    let memberTimes = [];
    let analysisSource = 'BACKEND_API';

    try {
        const backendRes = await fetch(`${BACKEND_BASE_URL}/optimal-center`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                purpose: meetingPurpose,
                locations: validMembers.map(m => ({ lat: m.lat, lng: m.lng }))
            })
        });

        if (backendRes.ok) {
            const data = await backendRes.json();
            if (data.latitude && data.longitude) {
                selectedLat = Number(data.latitude);
                selectedLng = Number(data.longitude);
                selectedAreaName = data.centerName || '추천 중심 상권';
                memberTimes = Array.isArray(data.memberTravelMinutes) && data.memberTravelMinutes.length === validMembers.length
                    ? data.memberTravelMinutes
                    : validMembers.map(m => estimateTransitMinutes(m.lat, m.lng, selectedLat, selectedLng));
            }
        }
    } catch (err) {
        // 백엔드 서버가 미실행 중일 경우 아래 프론트엔드 폴백 로직으로 자동 처리
    }

    if (selectedLat === null || selectedLng === null) {
        analysisSource = 'FRONTEND_FALLBACK';
        const rawLat = validMembers.reduce((acc, m) => acc + m.lat, 0) / validMembers.length;
        const rawLng = validMembers.reduce((acc, m) => acc + m.lng, 0) / validMembers.length;
        const rawCenter = new kakao.maps.LatLng(rawLat, rawLng);

        let stationRes = await searchCategoryPromise('SW8', rawCenter, 5000);
        let candidates = stationRes.places;

        if (candidates.length === 0) {
            const fallbackRes = await searchKeywordPromise('역', rawCenter, 10000);
            candidates = fallbackRes.places;
        }

        selectedLat = rawLat;
        selectedLng = rawLng;
        selectedAreaName = '중간 지점';
        memberTimes = validMembers.map(m => estimateTransitMinutes(m.lat, m.lng, rawLat, rawLng));

        if (candidates.length > 0) {
            let bestScore = Infinity;

            for (const cand of candidates.slice(0, 8)) {
                const cLat = parseFloat(cand.y);
                const cLng = parseFloat(cand.x);
                const cPos = new kakao.maps.LatLng(cLat, cLng);

                const foodCheck = await searchCategoryPromise('FD6', cPos, 500);
                if (foodCheck.totalCount < 5) continue;

                const times = validMembers.map(m => estimateTransitMinutes(m.lat, m.lng, cLat, cLng));
                const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
                const variance = times.reduce((acc, t) => acc + Math.pow(t - avgTime, 2), 0) / times.length;
                const stdDev = Math.sqrt(variance);

                const totalScore = avgTime + (stdDev * 1.5) - Math.min(foodCheck.totalCount * 0.05, 8);

                if (totalScore < bestScore) {
                    bestScore = totalScore;
                    selectedLat = cLat;
                    selectedLng = cLng;
                    selectedAreaName = `${cand.place_name} 인근 상권`;
                    memberTimes = times;
                }
            }
        }
    }

    currentSelectedAreaName = selectedAreaName;

    const centerPos = new kakao.maps.LatLng(selectedLat, selectedLng);
    const avgTransitMin = Math.round(memberTimes.reduce((a, b) => a + b, 0) / memberTimes.length);
    const maxDiffMin = Math.max(...memberTimes) - Math.min(...memberTimes);

    marker.setPosition(centerPos);
    infowindow.setContent(`
        <div class="iw-box">
            <div style="font-weight:bold;margin-bottom:2px;">📍 ${escapeHtml(selectedAreaName)}</div>
            <div style="color:#2563eb;font-weight:bold;">평균 약 ${avgTransitMin}분 (편차 ${maxDiffMin}분)</div>
        </div>
    `);
    infowindow.open(map, marker);

    if (radiusCircle) radiusCircle.setMap(null);
    radiusCircle = new kakao.maps.Circle({
        center: centerPos,
        radius: 800,
        strokeWeight: 2,
        strokeColor: '#2563eb',
        strokeOpacity: 0.8,
        fillColor: '#3b82f6',
        fillOpacity: 0.15
    });
    radiusCircle.setMap(map);

    const bounds = new kakao.maps.LatLngBounds();
    validMembers.forEach(m => bounds.extend(new kakao.maps.LatLng(m.lat, m.lng)));
    bounds.extend(centerPos);
    map.setBounds(bounds);

    currentCategorizedGroups = [];

    if (meetingPurpose === 'DINING') {
        const res = await searchCategoryPromise('FD6', centerPos, 600);
        currentCategorizedGroups = [
            { key: 'DINING', shortLabel: '식사·맛집', title: '🍽️ 식사 / 맛집 / 회식', places: prepareAllPlaces(res.places) }
        ];

    } else if (meetingPurpose === 'CAFE') {
        const res = await searchCategoryPromise('CE7', centerPos, 600);
        currentCategorizedGroups = [
            { key: 'CAFE', shortLabel: '카페·스터디', title: '☕ 카페 / 수다 / 스터디', places: prepareAllPlaces(res.places) }
        ];

    } else if (meetingPurpose === 'SHOPPING') {
        const [martRes, clothRes, shopRes] = await Promise.all([
            searchCategoryPromise('MT1', centerPos, 800),
            searchKeywordPromise('의류', centerPos, 600),
            searchKeywordPromise('마트', centerPos, 600)
        ]);
        currentCategorizedGroups = [
            { key: 'HYPERMART', shortLabel: '대형마트', title: '🏬 대형마트', places: prepareAllPlaces(martRes.places) },
            { key: 'CLOTHING', shortLabel: '의류·패션', title: '👕 의류 / 쇼핑', places: prepareAllPlaces(clothRes.places) },
            { key: 'MART', shortLabel: '마트·편의', title: '🛒 마트 / 생필품', places: prepareAllPlaces(shopRes.places) }
        ];

    } else if (meetingPurpose === 'CULTURE') {
        const gameTasks = [
            () => searchKeywordPromise('노래방', centerPos, 700),
            () => searchKeywordPromise('코인노래방', centerPos, 700),
            () => searchKeywordPromise('보드게임카페', centerPos, 700),
            () => searchKeywordPromise('만화카페', centerPos, 700),
            () => searchKeywordPromise('방탈출카페', centerPos, 700),
            () => searchKeywordPromise('VR카페', centerPos, 700),
            () => searchKeywordPromise('레이저서바이벌', centerPos, 800),
            () => searchKeywordPromise('PC방', centerPos, 700),
            () => searchKeywordPromise('오락실', centerPos, 700)
        ];

        const sportTasks = [
            () => searchKeywordPromise('당구장', centerPos, 700),
            () => searchKeywordPromise('탁구장', centerPos, 800),
            () => searchKeywordPromise('실내배드민턴', centerPos, 800),
            () => searchKeywordPromise('스크린골프', centerPos, 800),
            () => searchKeywordPromise('양궁카페', centerPos, 800),
            () => searchKeywordPromise('실내사격', centerPos, 800),
            () => searchKeywordPromise('클라이밍', centerPos, 800),
            () => searchKeywordPromise('롤러스케이트장', centerPos, 800),
            () => searchKeywordPromise('볼링장', centerPos, 800),
            () => searchKeywordPromise('스크린야구', centerPos, 800)
        ];

        const watchTasks = [
            () => searchCategoryPromise('CT1', centerPos, 800),
            () => searchKeywordPromise('소극장', centerPos, 800),
            () => searchKeywordPromise('공연장', centerPos, 800),
            () => searchKeywordPromise('다트바', centerPos, 700),
            () => searchKeywordPromise('라이브카페', centerPos, 700)
        ];

        const craftTasks = [
            () => searchKeywordPromise('공방', centerPos, 700),
            () => searchKeywordPromise('도자기공방', centerPos, 800),
            () => searchKeywordPromise('반지공방', centerPos, 800),
            () => searchKeywordPromise('셀프사진관', centerPos, 700),
            () => searchKeywordPromise('인생네컷', centerPos, 700)
        ];

        const [gameRes, sportRes, watchRes, craftRes] = await Promise.all([
            runTasksInBatches(gameTasks, 5),
            runTasksInBatches(sportTasks, 5),
            runTasksInBatches(watchTasks, 5),
            runTasksInBatches(craftTasks, 5)
        ]);

        currentCategorizedGroups = [
            { key: 'GAME', shortLabel: '놀이·게임', title: '🎮 1. 실내 놀이 및 게임', places: prepareAllPlaces(gameRes.flatMap(r => r.places)) },
            { key: 'SPORT', shortLabel: '실내스포츠', title: '🎳 2. 실내 스포츠 및 액티비티', places: prepareAllPlaces(sportRes.flatMap(r => r.places)) },
            { key: 'WATCH', shortLabel: '문화·관람', title: '🎬 3. 문화 및 관람 시설', places: prepareAllPlaces(watchRes.flatMap(r => r.places)) },
            { key: 'CRAFT', shortLabel: '공방·포토', title: '🎨 4. 이색 체험 및 공방', places: prepareAllPlaces(craftRes.flatMap(r => r.places)) }
        ];
    }

    const displayedTotalCount = currentCategorizedGroups.reduce((sum, g) => sum + g.places.length, 0);

    const jsonObj = {
        source: analysisSource,
        purpose: meetingPurpose,
        selectedHub: {
            areaName: selectedAreaName,
            latitude: Number(selectedLat.toFixed(6)),
            longitude: Number(selectedLng.toFixed(6)),
            avgTransitMinutes: avgTransitMin,
            maxTimeDiffMinutes: maxDiffMin
        },
        members: validMembers.map((m, i) => ({
            name: `인원 ${i + 1}`,
            startPlace: m.placeName,
            estimatedTransitMinutes: memberTimes[i]
        })),
        categorizedSummary: currentCategorizedGroups
            .filter(g => g.places.length > 0)
            .map(g => ({
                category: g.title,
                displayedCount: g.places.length,
                places: g.places.map(p => `${p.place_name} (${p.distance}m)`)
            })),
        displayedTotalPlaces: displayedTotalCount
    };
    document.getElementById('jsonDisplay').textContent = JSON.stringify(jsonObj, null, 2);

    renderCategorizedRecommendations('ALL');
}

function copyJsonData() {
    const text = document.getElementById('jsonDisplay').textContent;
    navigator.clipboard.writeText(text).then(() => alert('JSON이 복사되었습니다.'));
}

renderMembers();
renderFavoritesBox();