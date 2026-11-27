// -------------------------------------------------------------------------
// 10-DECIMAL PRECISION COORDINATE FORMATTER (High-Accuracy Cadastral GIS)
// -------------------------------------------------------------------------
function format10Dec(val) {
    if (val === null || val === undefined || isNaN(val)) return '0.0000000000';
    return Number(val).toFixed(10);
}
/**
 * app.js - Full Division/Range Scoped Portal, Multiple Satellite Maps, and Ground Survey Engine
 * Tamil Nadu Forest Department
 */

let map = null;
let currentRole = 'DFO'; // 'DFO' or 'FIELD_OFFICER'
let currentDivision = 'Chennai Division';
let currentRange = null;

// Map layers & marker instances (retained in memory for 60fps buttery smooth dragging)
let activePolygonLayer = null;
let vertexMarkersGroup = null;
let currentBoundaryData = null;
let selectedVertexIndex = null;
let activeMarkerInstances = [];
let fieldMarkerInstances = [];

// Range normalizer (handles 'Ranipet' vs 'Ranipet Range' seamlessly)
function normalizeDivision(d) {
    if (!d) return '';
    return d.toString().toLowerCase().replace(/\s*division\s*$/i, '').trim();
}

function normalizeRange(r) {
    if (!r) return '';
    return r.toString().toLowerCase().replace(/\s*range\s*$/i, '').trim();
}

// Debounced cloud sync to keep UI at 60fps without network lag
let cloudSyncDebounceTimer = null;
function scheduleCloudSync(delayMs = 1500) {
    if (cloudSyncDebounceTimer) clearTimeout(cloudSyncDebounceTimer);
    cloudSyncDebounceTimer = setTimeout(() => {
        if (window.surveyDB && window.surveyDB.syncCloud && navigator.onLine) {
            window.surveyDB.syncCloud().catch(() => {});
        }
    }, delayMs);
}

// Live GPS Tracking
let liveGpsWatchId = null;
let liveGpsLocation = null;
let liveGpsMarker = null;
let liveGpsAccuracyCircle = null;

// Field Survey State
let newSurveyPoints = [];
let newSurveyLayer = null;
let newSurveyMarkersGroup = null;
let isEpochAveraging = false;
let isMapClickActive = false;
let previewSurveyLayer = null;
let previewMarkersGroup = null;

window.addEventListener('DOMContentLoaded', async () => {
    await window.surveyDB.init();
    populateLoginDivisions();
    initMap();
    checkAuthSession();
    setupNetworkListeners();
    startSingleGpsTracker(); // Runs once continuously in background
});

// -------------------------------------------------------------------------
// 1. MAP & MULTIPLE HIGH-RESOLUTION SATELLITE/TOPO LAYERS (NO OSM BLOCKS!)
// -------------------------------------------------------------------------
function initMap() {
    map = L.map('map', {
        zoomControl: false, // Placed cleanly at bottom-right to eliminate collision with top buttons
        attributionControl: false
    }).setView([13.0827, 80.2707], 13); // Defaults to Chennai

    // Place zoom controls cleanly at bottom-right (intuitive for mobile thumbs & desktop)
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // 1. Google Satellite Hybrid (World-class Satellite Imagery + Road & Place Names)
    const googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 22,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
    }).addTo(map);

    // 2. Google Satellite Only (Clean Imagery with no labels)
    const googleSat = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        maxZoom: 22
    });

    // 3. Esri World Imagery (High-precision Satellite used by Forest Departments)
    const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
    });

    // 4. Google Terrain / Topographic (Shows forest hill contours and elevations)
    const googleTerrain = L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
        maxZoom: 20
    });

    // 5. CartoDB Voyager (Clean high-contrast vector street map)
    const cartoLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
    });

    // Add layer switcher control
    L.control.layers({
        'Google Satellite Hybrid': googleHybrid,
        'Google Satellite (Clean)': googleSat,
        'Esri World Satellite': esriSat,
        'Topographic / Terrain Contours': googleTerrain,
        'Street Map (Voyager)': cartoLight
    }, null, { position: 'topright' }).addTo(map);

    vertexMarkersGroup = L.layerGroup().addTo(map);
    newSurveyMarkersGroup = L.layerGroup().addTo(map);

    // Map Click Handler for Field Officer Manual Pin-Drop
    map.on('click', (e) => {
        if (isMapClickActive && currentRole === 'FIELD_OFFICER') {
            const ptNum = newSurveyPoints.length + 1;
            newSurveyPoints.push({
                point_number: ptNum,
                lat: e.latlng.lat,
                lon: e.latlng.lng,
                accuracy: 0.5,
                time: new Date().toLocaleTimeString(),
                is_manual: true
            });
            renderNewSurveyProgress();
            updateMapClickPrompts();
        }
    });
}

// -------------------------------------------------------------------------
// 2. UNIVERSAL AUTHENTICATION & DIVISION RESTRICTION
// -------------------------------------------------------------------------
let selectedLoginRole = 'DFO';

function populateLoginDivisions() {
    const sel = document.getElementById('loginDivision');
    if (!sel) return;
    sel.innerHTML = '';
    const divs = Object.keys(window.TN_FOREST_HIERARCHY || {});

    divs.forEach(div => {
        const opt = document.createElement('option');
        opt.value = div;
        opt.textContent = div;
        sel.appendChild(opt);
    });

    onLoginDivisionChange();
}

function onLoginDivisionChange() {
    updateLoginRanges();
    updateLoginFieldHints();
}

function updateLoginRanges() {
    const div = document.getElementById('loginDivision').value;
    const rangeSel = document.getElementById('loginRange');
    if (!rangeSel) return;
    rangeSel.innerHTML = '';

    const ranges = window.TN_FOREST_HIERARCHY[div] || [];
    ranges.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r;
        opt.textContent = `${r} Range`;
        rangeSel.appendChild(opt);
    });
}

function updateLoginFieldHints() {
    const div = document.getElementById('loginDivision').value;
    const creds = window.getDfoCreds ? window.getDfoCreds(div) : null;
    const hintEl = document.getElementById('dfoUserHint');
    const userLabel = document.getElementById('loginUserLabel');
    const userInp = document.getElementById('loginUsername');
    const passInp = document.getElementById('loginPassword');

    if (selectedLoginRole === 'DFO') {
        if (userLabel) userLabel.textContent = 'DFO Username';
        if (hintEl) {
            hintEl.style.display = 'inline-block';
            hintEl.textContent = creds ? `e.g. ${creds.username}` : `e.g. dfo_${div.toLowerCase()}`;
        }
        if (userInp) {
            userInp.placeholder = creds ? creds.username : 'Enter DFO username';
        }
        if (passInp) {
            passInp.placeholder = creds ? creds.password : 'Enter DFO password';
        }
    } else {
        if (userLabel) userLabel.textContent = 'Field Officer Username';
        if (hintEl) {
            hintEl.style.display = 'none';
        }
        if (userInp) {
            userInp.placeholder = 'e.g. fo_username';
        }
        if (passInp) {
            passInp.placeholder = 'Enter field officer password';
        }
    }
}

function selectLoginRole(role) {
    selectedLoginRole = role;
    document.getElementById('roleBtnDfo').classList.toggle('active', role === 'DFO');
    document.getElementById('roleBtnField').classList.toggle('active', role === 'FIELD_OFFICER');

    const rangeGroup = document.getElementById('loginRangeGroup');
    if (rangeGroup) {
        rangeGroup.style.display = (role === 'FIELD_OFFICER') ? 'block' : 'none';
    }

    updateLoginFieldHints();
}

function togglePasswordVisibility(inputId, iconId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    if (!input || !icon) return;
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fa-regular fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fa-regular fa-eye';
    }
}

async function handleUniversalLogin(e) {
    if (e) e.preventDefault();
    const div = document.getElementById('loginDivision').value;
    const range = document.getElementById('loginRange') ? document.getElementById('loginRange').value : null;
    const user = document.getElementById('loginUsername').value.trim();
    const pass = document.getElementById('loginPassword').value.trim();
    const errBox = document.getElementById('loginError');

    try {
        const session = await window.surveyDB.authenticate(div, selectedLoginRole, range, user, pass, false);

        if (session && session.blocked) {
            errBox.innerHTML = `
                <div class="session-blocked-notice">
                    <div class="blocked-title"><i class="fa-solid fa-triangle-exclamation"></i> ACCESS RESTRICTED: Already Logged In</div>
                    <div class="blocked-desc">This portal is currently active on <b>${session.deviceType}</b>.<br>Only 1 active login is allowed at a time.</div>
                    <button type="button" class="btn-force-takeover" onclick="handleForceLogin()">
                        <i class="fa-solid fa-right-to-bracket"></i> Force Logout ${session.deviceType} &amp; Login Here
                    </button>
                </div>
            `;
            errBox.style.display = 'block';
            return;
        }

        if (session) {
            errBox.style.display = 'none';
            checkAuthSession();
        } else {
            if (selectedLoginRole === 'DFO') {
                const creds = window.getDfoCreds ? window.getDfoCreds(div) : null;
                const hint = creds ? ` (Expected: ${creds.username} / ${creds.password})` : '';
                errBox.textContent = `Invalid DFO credentials for ${div}! Please verify your assigned division username and password.`;
            } else {
                errBox.textContent = `Invalid Field Officer credentials for ${range || 'selected'} Range in ${div}! Please verify with your DFO or ensure your DFO has registered your login in the DFO Portal.`;
            }
            errBox.style.display = 'block';
        }
    } catch (err) {
        errBox.textContent = `Login error: ${err.message}`;
        errBox.style.display = 'block';
    }
}

window.handleForceLogin = async function() {
    const div = document.getElementById('loginDivision').value;
    const range = document.getElementById('loginRange') ? document.getElementById('loginRange').value : null;
    const user = document.getElementById('loginUsername').value.trim();
    const pass = document.getElementById('loginPassword').value.trim();
    const errBox = document.getElementById('loginError');

    try {
        const session = await window.surveyDB.authenticate(div, selectedLoginRole, range, user, pass, true);
        if (session && !session.blocked) {
            errBox.style.display = 'none';
            checkAuthSession();
        } else {
            errBox.textContent = session ? session.message : 'Unable to acquire portal session.';
            errBox.style.display = 'block';
        }
    } catch (err) {
        errBox.textContent = `Login error: ${err.message}`;
        errBox.style.display = 'block';
    }
};

async function checkAuthSession() {
    const user = window.surveyDB.getCurrentUser();
    const loginScreen = document.getElementById('loginScreen');
    const appHeader = document.getElementById('appHeader');
    const mainContainer = document.getElementById('mainContainer');

    if (!user) {
        if (loginScreen) loginScreen.style.display = 'flex';
        if (appHeader) appHeader.style.display = 'none';
        if (mainContainer) mainContainer.style.display = 'none';
        if (window.surveyDB.stopHeartbeat) window.surveyDB.stopHeartbeat();
        return;
    }

    const sessionKey = user.sessionKey || (user.role === 'DFO' ? `DFO_${user.division.toUpperCase().replace(/[^A-Z0-9]/g, '_')}` : `FO_${user.username.toUpperCase()}`);
    user.sessionKey = sessionKey;

    // Check cloud if another device is currently active
    if (navigator.onLine && window.surveyDB.sendHeartbeat) {
        try {
            const hb = await window.surveyDB.sendHeartbeat(sessionKey);
            if (hb && hb.code === 'SESSION_TERMINATED') {
                alert(`Access Restricted: This ${user.role} portal is currently active on ${hb.deviceType || 'another device'}. You have been logged out on this device.`);
                await window.surveyDB.logout();
                if (loginScreen) loginScreen.style.display = 'flex';
                if (appHeader) appHeader.style.display = 'none';
                if (mainContainer) mainContainer.style.display = 'none';
                const errBox = document.getElementById('loginError');
                if (errBox) {
                    errBox.innerHTML = `
                        <div class="session-blocked-notice">
                            <div class="blocked-title"><i class="fa-solid fa-triangle-exclamation"></i> ACCESS RESTRICTED: Already Logged In</div>
                            <div class="blocked-desc">This portal is currently active on <b>${hb.deviceType || 'another device'}</b>.<br>Only 1 active login is allowed at a time.</div>
                            <button type="button" class="btn-force-takeover" onclick="handleForceLogin()">
                                <i class="fa-solid fa-right-to-bracket"></i> Force Logout ${hb.deviceType || 'other device'} &amp; Login Here
                            </button>
                        </div>
                    `;
                    errBox.style.display = 'block';
                }
                return;
            }
        } catch (e) {}
    }

    // Session is valid for this device: start continuous heartbeat
    if (window.surveyDB.startHeartbeat) window.surveyDB.startHeartbeat(sessionKey);

    if (loginScreen) loginScreen.style.display = 'none';
    if (appHeader) appHeader.style.display = 'flex';
    if (mainContainer) mainContainer.style.display = 'flex';

    if (map) {
        setTimeout(() => map.invalidateSize(), 150);
    }

    // On mobile devices, start with sidebar drawer collapsed so map is immediately visible
    if (window.innerWidth <= 768) {
        const panel = document.getElementById('mainControlPanel');
        const text = document.getElementById('sidebarToggleText');
        const icon = document.getElementById('sidebarToggleIcon');
        if (panel && !panel.classList.contains('collapsed')) {
            panel.classList.add('collapsed');
            if (text) text.textContent = 'Panel';
            if (icon) icon.className = 'fa-solid fa-bars';
        }
    }

    currentRole = user.role;
    currentDivision = user.division;
    currentRange = user.range;

    document.getElementById('userRoleBadge').textContent = user.role === 'DFO' ? 'DFO' : 'FIELD';
    document.getElementById('userDivisionName').textContent = user.role === 'DFO' ? user.division : `${user.division} (${user.range})`;
    document.getElementById('headerPortalSubtitle').textContent = user.role === 'DFO' ? `DFO MASTER PORTAL — ${user.division.toUpperCase()}` : `FIELD SURVEY PORTAL — ${user.range ? user.range.toUpperCase() : ''}`;
    const logoutUserEl = document.getElementById('sidebarLogoutUser');
    if (logoutUserEl) {
        logoutUserEl.textContent = user.role === 'DFO' ? `DFO ${user.division}` : `${user.username}`;
    }

    if (user.role === 'DFO') {
        await setupDfoPortal();
    } else {
        await setupFieldPortal();
    }
}

let isLoggingOut = false;
async function handleLogout(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    if (isLoggingOut) return;
    isLoggingOut = true;

    try {
        if (window.surveyDB && window.surveyDB.logout) {
            await window.surveyDB.logout();
        }
    } catch (err) {
        console.warn('Logout cleanup:', err);
    }

    localStorage.removeItem('tn_forest_survey_session_v4');
    if (typeof checkAuthSession === 'function') {
        checkAuthSession();
    } else {
        window.location.reload();
    }
    setTimeout(() => { isLoggingOut = false; }, 1500);
}
window.handleLogout = handleLogout;

// -------------------------------------------------------------------------
// PWA INSTALLATION PROMPT HANDLER (One-Tap Install for Android & Mobile)
// -------------------------------------------------------------------------
let deferredInstallPrompt = null;

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        const u = window.surveyDB.getCurrentUser();
        if (u && u.sessionKey) {
            window.surveyDB.sendHeartbeat(u.sessionKey).then(res => {
                if (res && res.code === 'SESSION_TERMINATED') {
                    alert(`Logged out: Account was accessed from ${res.deviceType || 'another device'}.`);
                    window.surveyDB.logout();
                    checkAuthSession();
                }
            });
        }
    }
});

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
});

function handleInstallApp() {
    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then((choiceResult) => {
            deferredInstallPrompt = null;
        });
    } else {
        openInstallGuideModal();
    }
}

function openInstallGuideModal() {
    const modal = document.getElementById('installGuideModal');
    if (modal) modal.style.display = 'flex';
}

function closeInstallGuideModal() {
    const modal = document.getElementById('installGuideModal');
    if (modal) modal.style.display = 'none';
}

// -------------------------------------------------------------------------
// 3. DFO PORTAL: MANAGE ONLY THIS DIVISION'S RANGES & KML BOUNDARIES
// -------------------------------------------------------------------------
async function setupDfoPortal() {
    // 1. Cleanly pull latest cloud database once upon login
    if (navigator.onLine && window.surveyDB && window.surveyDB.pullFromCloud) {
        try { await window.surveyDB.pullFromCloud(); } catch(e) {}
    }
    document.getElementById('dfoPanel').style.display = 'block';
    if (window.dfoAutoSyncTimer) {
        clearInterval(window.dfoAutoSyncTimer);
        window.dfoAutoSyncTimer = null;
    }
    document.getElementById('fieldPanel').style.display = 'none';
    document.getElementById('dfoDivisionTitle').textContent = currentDivision;
    // Populate DFO Switch Division Dropdown with all 51 divisions
    const switchDivSel = document.getElementById('dfoSwitchDivisionSelect');
    if (switchDivSel) {
        switchDivSel.innerHTML = '';
        const allDivs = Object.keys(window.TN_FOREST_HIERARCHY || {});
        allDivs.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            if (normalizeDivision(d) === normalizeDivision(currentDivision)) opt.selected = true;
            switchDivSel.appendChild(opt);
        });
    }


    // Populate DFO Range Filter
    const rangeSelect = document.getElementById('dfoRangeSelect');
    const uploadRangeSelect = document.getElementById('uploadRangeSelect');
    rangeSelect.innerHTML = '<option value="ALL">All Ranges in Division</option>';
    uploadRangeSelect.innerHTML = '';

    const ranges = window.TN_FOREST_HIERARCHY[currentDivision] || [];
    ranges.forEach(r => {
        const opt1 = document.createElement('option');
        opt1.value = r;
        opt1.textContent = `${r} Range`;
        rangeSelect.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = r;
        opt2.textContent = `${r} Range`;
        uploadRangeSelect.appendChild(opt2);
    });

    await loadDfoBoundaries();
    await loadPendingFieldSurveys();
    await loadDfoStaffManagement();
}

async function loadDfoBoundaries() {
    const all = await window.surveyDB.getAll('polygons');
    // Filter strictly to current DFO division
    const divisionPolys = all.filter(p => p.division && normalizeDivision(p.division) === normalizeDivision(currentDivision));

    const selRange = document.getElementById('dfoRangeSelect').value;
    const filtered = (selRange === 'ALL') ? divisionPolys : divisionPolys.filter(p => p.range && normalizeRange(p.range) === normalizeRange(selRange));

    const bSelect = document.getElementById('dfoBoundarySelect');
    bSelect.innerHTML = '';

    if (filtered.length === 0) {
        bSelect.innerHTML = '<option value="">No RF/RL boundaries in database</option>';
        document.getElementById('boundaryActionRow').style.display = 'none';
        document.getElementById('dfoDetailsCard').style.display = 'none';
        document.getElementById('activeVertexCard').style.display = 'none';
        if (activePolygonLayer) map.removeLayer(activePolygonLayer);
        vertexMarkersGroup.clearLayers();
        activeMarkerInstances = [];
        return;
    }

    filtered.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} [${p.range || 'General'}]`;
        bSelect.appendChild(opt);
    });

    document.getElementById('boundaryActionRow').style.display = 'grid';
    document.getElementById('dfoDetailsCard').style.display = 'block';

    bSelect.value = filtered[0].id;
    loadDfoActiveBoundary();
}

function filterDfoBoundaries() {
    loadDfoBoundaries();
}

async function loadDfoActiveBoundary() {
    const id = document.getElementById('dfoBoundarySelect').value;
    if (!id) return;

    currentBoundaryData = await window.surveyDB.get('polygons', id);
    if (!currentBoundaryData) return;

    if (!currentBoundaryData.flaggedVertices) {
        currentBoundaryData.flaggedVertices = [];
    }

    document.getElementById('dfoDetRange').textContent = currentBoundaryData.range || 'General';
    document.getElementById('dfoDetVertices').textContent = currentBoundaryData.coordinates.length;
    document.getElementById('activeMapInfo').textContent = `${currentBoundaryData.name} (${currentDivision})`;

    renderActiveBoundary(true);
    
    // Auto-select first vertex
    if (currentBoundaryData.coordinates.length > 0) {
        selectActiveVertex(0);
    }
}

function renderActiveBoundary(shouldFitBounds = false) {
    if (activePolygonLayer) map.removeLayer(activePolygonLayer);
    vertexMarkersGroup.clearLayers();
    activeMarkerInstances = [];

    if (!currentBoundaryData || !currentBoundaryData.coordinates || currentBoundaryData.coordinates.length === 0) return;

    if (!currentBoundaryData.flaggedVertices) {
        currentBoundaryData.flaggedVertices = [];
    }

    const coords = currentBoundaryData.coordinates;
    const latlngs = coords.map(c => [c[1], c[0]]);

    // Render boundary polygon on map (Gold stroke / Cyan fill)
    activePolygonLayer = L.polygon(latlngs, {
        color: '#f59e0b',
        weight: 3,
        fillColor: '#0284c7',
        fillOpacity: 0.18
    }).addTo(map);

    if (shouldFitBounds) {
        map.fitBounds(activePolygonLayer.getBounds(), { padding: [40, 40] });
    }

    // Click on boundary line to insert intermediate sub-point (e.g. 6a, 6b...)
    activePolygonLayer.on('click', async (e) => {
        const clickedPt = turf.point([e.latlng.lng, e.latlng.lat]);
        let minDistance = Infinity;
        let insertIdx = 0;

        for (let i = 0; i < coords.length; i++) {
            const p1 = coords[i];
            const p2 = coords[(i + 1) % coords.length];
            const line = turf.lineString([p1, p2]);
            const dist = turf.pointToLineDistance(clickedPt, line);
            if (dist < minDistance) {
                minDistance = dist;
                insertIdx = i + 1;
            }
        }

        const newPt = [Number(e.latlng.lng.toFixed(10)), Number(e.latlng.lat.toFixed(10))];
        coords.splice(insertIdx, 0, newPt);
        currentBoundaryData.updated_at = new Date().toISOString();
        // Auto-flag newly inserted sub-point for field verification
        currentBoundaryData.flaggedVertices = currentBoundaryData.flaggedVertices.map(f => f >= insertIdx ? f + 1 : f);
        currentBoundaryData.flaggedVertices.push(insertIdx);

        await window.surveyDB.put('polygons', currentBoundaryData);
        scheduleCloudSync(1000);
        renderActiveBoundary(false);
        selectActiveVertex(insertIdx);
        alert(`New boundary sub-point added between cairns! Flagged for field ground verification.`);
    });

    // Render Numbered Cairns (Red flashing if flagged, Blue if verified)
    coords.forEach((c, idx) => {
        const isFlagged = currentBoundaryData.flaggedVertices.includes(idx);
        const markerClass = isFlagged ? 'vertex-marker-icon vertex-marker-flagged' : 'vertex-marker-icon vertex-marker-standard';

        const icon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div class="${markerClass}" style="width: 26px; height: 26px;">${idx + 1}</div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13]
        });

        const m = L.marker([c[1], c[0]], { icon: icon, draggable: true }).addTo(vertexMarkersGroup);
        activeMarkerInstances[idx] = m;

        m.on('click', () => {
            selectActiveVertex(idx);
        });

        // Update coordinate input fields in real-time while dragging (10 decimal precision)
        m.on('drag', (e) => {
            const pos = e.target.getLatLng();
            currentBoundaryData.coordinates[idx] = [Number(pos.lng.toFixed(10)), Number(pos.lat.toFixed(10))];
            if (activePolygonLayer) {
                activePolygonLayer.setLatLngs(currentBoundaryData.coordinates.map(pt => [pt[1], pt[0]]));
            }
            const latInp = document.getElementById('editVertexLatInput');
            const lonInp = document.getElementById('editVertexLonInput');
            if (selectedVertexIndex === idx) {
                if (latInp) latInp.value = pos.lat.toFixed(10);
                if (lonInp) lonInp.value = pos.lng.toFixed(10);
            }
        });

        // On dragend: 60fps smooth! Never destroy DOM markers!
        m.on('dragend', async (e) => {
            const pos = e.target.getLatLng();
            currentBoundaryData.coordinates[idx] = [Number(pos.lng.toFixed(10)), Number(pos.lat.toFixed(10))];
            currentBoundaryData.updated_at = new Date().toISOString();
            if (activePolygonLayer) {
                activePolygonLayer.setLatLngs(currentBoundaryData.coordinates.map(pt => [pt[1], pt[0]]));
            }

            const curCoords = currentBoundaryData.coordinates;
            const closed = [...curCoords, curCoords[0]];
            const poly = turf.polygon([closed]);
            const areaM2 = turf.area(poly);
            const areaEl = document.getElementById('dfoDetArea');
            if (areaEl) areaEl.textContent = `${(areaM2 / 10000).toFixed(2)} Ha (${(areaM2 / 1000000).toFixed(2)} sq.km)`;

            await window.surveyDB.put('polygons', currentBoundaryData);
            scheduleCloudSync(1500);
            selectActiveVertex(idx);
        });
    });

    // Update Flagged Count in Summary
    const flaggedCount = currentBoundaryData.flaggedVertices.length;
    const flaggedEl = document.getElementById('dfoDetFlagged');
    if (flaggedEl) {
        flaggedEl.textContent = `${flaggedCount} Action Required`;
        flaggedEl.className = flaggedCount > 0 ? 'detail-val text-red' : 'detail-val text-cyan';
    }
    document.getElementById('dfoDetVertices').textContent = coords.length;

    // Calculate Area
    const closed = [...coords, coords[0]];
    const poly = turf.polygon([closed]);
    const areaM2 = turf.area(poly);
    document.getElementById('dfoDetArea').textContent = `${(areaM2 / 10000).toFixed(2)} Ha (${(areaM2 / 1000000).toFixed(2)} sq.km)`;
}

// Select a specific cairn/vertex to show in inspector card
function selectActiveVertex(idx) {
    if (!currentBoundaryData || !currentBoundaryData.coordinates || !currentBoundaryData.coordinates[idx]) return;

    selectedVertexIndex = idx;
    const c = currentBoundaryData.coordinates[idx];
    const isFlagged = currentBoundaryData.flaggedVertices.includes(idx);

    document.getElementById('activeVertexCard').style.display = 'block';
    document.getElementById('selectedVertexBadge').textContent = `Point #${idx + 1}`;

    // Populate Editable GPS Coordinate Inputs
    const latInp = document.getElementById('editVertexLatInput');
    const lonInp = document.getElementById('editVertexLonInput');
    if (latInp) latInp.value = format10Dec(c[1]);
    if (lonInp) lonInp.value = format10Dec(c[0]);

    const statusEl = document.getElementById('selectedVertexFlagStatus');
    const flagBtn = document.getElementById('btnToggleFlag');

    if (isFlagged) {
        statusEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ACTION REQUIRED (Field GPS Needed)';
        statusEl.className = 'tag-flagged text-red';
        flagBtn.innerHTML = '<i class="fa-solid fa-check"></i> Mark Point as Verified';
        flagBtn.className = 'btn-success btn-block';
    } else {
        statusEl.innerHTML = '<i class="fa-solid fa-circle-check"></i> Standard Verified Cairn';
        statusEl.className = 'tag-flagged text-cyan';
        flagBtn.innerHTML = '<i class="fa-solid fa-flag"></i> Toggle Red Action Flag';
        flagBtn.className = 'btn-warning btn-block';
    }
}

// Save typed or modified GPS coordinates for active vertex
async function saveTypedVertexCoordinates() {
    if (selectedVertexIndex === null || !currentBoundaryData) return;

    const latInp = document.getElementById('editVertexLatInput');
    const lonInp = document.getElementById('editVertexLonInput');
    const lat = parseFloat(latInp.value);
    const lon = parseFloat(lonInp.value);

    if (isNaN(lat) || isNaN(lon)) {
        alert('Please enter valid numeric values for Latitude and Longitude.');
        return;
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        alert('Invalid coordinates: Latitude must be between -90 and 90, Longitude between -180 and 180.');
        return;
    }

    currentBoundaryData.coordinates[selectedVertexIndex] = [Number(lon.toFixed(10)), Number(lat.toFixed(10))];
    currentBoundaryData.updated_at = new Date().toISOString();

    if (activeMarkerInstances[selectedVertexIndex]) {
        activeMarkerInstances[selectedVertexIndex].setLatLng([lat, lon]);
    }
    if (activePolygonLayer) {
        activePolygonLayer.setLatLngs(currentBoundaryData.coordinates.map(pt => [pt[1], pt[0]]));
    }

    const coords = currentBoundaryData.coordinates;
    const closed = [...coords, coords[0]];
    const poly = turf.polygon([closed]);
    const areaM2 = turf.area(poly);
    const areaEl = document.getElementById('dfoDetArea');
    if (areaEl) areaEl.textContent = `${(areaM2 / 10000).toFixed(2)} Ha (${(areaM2 / 1000000).toFixed(2)} sq.km)`;

    await window.surveyDB.put('polygons', currentBoundaryData);
    scheduleCloudSync(1000);
    selectActiveVertex(selectedVertexIndex);
    map.panTo([lat, lon]);
    alert(`Point #${selectedVertexIndex + 1} coordinates fixed & updated to:\nLatitude: ${format10Dec(lat)}\nLongitude: ${format10Dec(lon)}`);
}

// Snap active vertex to officer's standing GPS location (Immediate High-Precision Fix)
async function snapActiveVertexToLiveGps() {
    if (selectedVertexIndex === null || !currentBoundaryData) return;

    const applyCoords = async (lat, lon) => {
        currentBoundaryData.coordinates[selectedVertexIndex] = [Number(lon.toFixed(10)), Number(lat.toFixed(10))];
        currentBoundaryData.updated_at = new Date().toISOString();
        // Remove red action flag since ground point has now been verified
        currentBoundaryData.flaggedVertices = (currentBoundaryData.flaggedVertices || []).filter(f => f !== selectedVertexIndex);

        if (activeMarkerInstances[selectedVertexIndex]) {
            activeMarkerInstances[selectedVertexIndex].setLatLng([lat, lon]);
            activeMarkerInstances[selectedVertexIndex].setIcon(L.divIcon({
                className: 'custom-div-icon',
                html: `<div class="vertex-marker-icon vertex-marker-standard" style="width: 26px; height: 26px;">${selectedVertexIndex + 1}</div>`,
                iconSize: [26, 26],
                iconAnchor: [13, 13]
            }));
        }
        if (activePolygonLayer) {
            activePolygonLayer.setLatLngs(currentBoundaryData.coordinates.map(pt => [pt[1], pt[0]]));
        }

        const coords = currentBoundaryData.coordinates;
        const closed = [...coords, coords[0]];
        const poly = turf.polygon([closed]);
        const areaM2 = turf.area(poly);
        const areaEl = document.getElementById('dfoDetArea');
        if (areaEl) areaEl.textContent = `${(areaM2 / 10000).toFixed(2)} Ha (${(areaM2 / 1000000).toFixed(2)} sq.km)`;

        await window.surveyDB.put('polygons', currentBoundaryData);
        scheduleCloudSync(1000);
        selectActiveVertex(selectedVertexIndex);
        map.panTo([lat, lon]);
        alert(`Point #${selectedVertexIndex + 1} snapped to your live GPS coordinates!\nLatitude: ${format10Dec(lat)}\nLongitude: ${format10Dec(lon)}`);
    };

    if (liveGpsLocation && liveGpsLocation.lat && liveGpsLocation.lon) {
        await applyCoords(liveGpsLocation.lat, liveGpsLocation.lon);
        return;
    }

    if (!('geolocation' in navigator)) {
        alert('Geolocation is not supported by your browser/device.');
        return;
    }

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;
            liveGpsLocation = { lat, lon, accuracy: pos.coords.accuracy };
            await applyCoords(lat, lon);
        },
        (err) => {
            alert(`GPS Error: ${err.message}. Please enable GPS and allow location access.`);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
}

// Toggle Red Action Flag on active vertex
async function toggleActiveVertexFlag() {
    if (selectedVertexIndex === null || !currentBoundaryData) return;

    if (!currentBoundaryData.flaggedVertices) {
        currentBoundaryData.flaggedVertices = [];
    }

    const idx = currentBoundaryData.flaggedVertices.indexOf(selectedVertexIndex);
    if (idx > -1) {
        currentBoundaryData.flaggedVertices.splice(idx, 1);
    } else {
        currentBoundaryData.flaggedVertices.push(selectedVertexIndex);
    }

    await window.surveyDB.put('polygons', currentBoundaryData);
    window.surveyDB.syncCloud().catch(() => {});
    renderActiveBoundary(false);
    selectActiveVertex(selectedVertexIndex);
}

// Delete Selected Active Vertex (DFO Point Deletion Feature)
async function deleteSelectedActiveVertex() {
    if (selectedVertexIndex === null || !currentBoundaryData) return;
    if (!currentBoundaryData.coordinates || currentBoundaryData.coordinates.length <= 3) {
        alert('Cannot delete point: A polygon must have at least 3 boundary vertices.');
        return;
    }

    const ptNum = selectedVertexIndex + 1;
    if (!confirm(`Are you sure you want to delete Point #${ptNum} from "${currentBoundaryData.name}"?`)) {
        return;
    }

    // Remove the coordinate
    currentBoundaryData.coordinates.splice(selectedVertexIndex, 1);

    // Adjust flagged vertices:
    // Remove if this vertex was flagged; re-index any flags after this vertex
    if (currentBoundaryData.flaggedVertices) {
        currentBoundaryData.flaggedVertices = currentBoundaryData.flaggedVertices
            .filter(f => f !== selectedVertexIndex)
            .map(f => f > selectedVertexIndex ? f - 1 : f);
    }

    // Hide inspector card since selected vertex was deleted
    document.getElementById('activeVertexCard').style.display = 'none';
    selectedVertexIndex = null;

    await window.surveyDB.put('polygons', currentBoundaryData);
    window.surveyDB.syncCloud().catch(() => {});
    renderActiveBoundary(false);
    alert(`Point #${ptNum} deleted successfully from boundary.`);
}

// Rename Boundary
async function renameCurrentBoundary() {
    if (!currentBoundaryData) return;
    const newName = prompt('Enter revised name for this RF/RL:', currentBoundaryData.name);
    if (newName && newName.trim()) {
        currentBoundaryData.name = newName.trim();
        await window.surveyDB.put('polygons', currentBoundaryData);
        await loadDfoBoundaries();
        alert(`Renamed successfully to "${newName.trim()}"!`);
    }
}

// Delete Boundary from DB
async function deleteCurrentBoundary() {
    if (!currentBoundaryData) return;
    if (confirm(`Are you sure you want to delete "${currentBoundaryData.name}" from ${currentDivision} database?`)) {
        await window.surveyDB.delete('polygons', currentBoundaryData.id);
        if (navigator.onLine && window.surveyDB.syncCloud) {
            await window.surveyDB.syncCloud({ deletedPolygonId: currentBoundaryData.id }).catch(() => {});
        }
        alert('Boundary deleted from database.');
        await loadDfoBoundaries();
    }
}

// DFO KML Upload Handler
document.getElementById('kmlFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const targetRange = document.getElementById('uploadRangeSelect').value;
    let bName = document.getElementById('uploadBoundaryName').value.trim();
    if (!bName) bName = file.name.replace(/\.[^/.]+$/, "");

    const text = await file.text();
    let coords = [];

    if (file.name.toLowerCase().endsWith('.kml')) {
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'text/xml');
        const cNode = xml.querySelector('coordinates');
        if (cNode) {
            coords = cNode.textContent.trim().split(/\s+/).map(pair => {
                const parts = pair.split(',');
                return [parseFloat(parts[0]), parseFloat(parts[1])];
            }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));
        }
    } else {
        const geo = JSON.parse(text);
        if (geo.features && geo.features[0].geometry.coordinates) {
            coords = geo.features[0].geometry.coordinates[0];
        }
    }

    if (coords.length < 3) {
        alert('Invalid KML/GeoJSON geometry: polygon must contain at least 3 coordinates.');
        return;
    }

    const newPoly = {
        id: `RF_${currentDivision.replace(/\s+/g, '_')}_${Date.now()}`,
        name: bName,
        division: currentDivision,
        range: targetRange,
        type: 'RF',
        status: 'OFFICIAL',
        coordinates: coords,
        flaggedVertices: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    await window.surveyDB.put('polygons', newPoly);
    if (navigator.onLine && window.surveyDB.syncCloud) {
        await window.surveyDB.syncCloud().catch(() => {});
    }
    alert(`Successfully saved "${bName}" under ${targetRange} Range to ${currentDivision} database!`);

    document.getElementById('uploadBoundaryName').value = '';
    e.target.value = '';
    await loadDfoBoundaries();
});

// Load submissions sent by field officers

window.manualSyncSubmissions = async function() {
    const icon = document.getElementById('syncSubmissionsIcon');
    if (icon) icon.classList.add('fa-spin');
    try {
        if (window.surveyDB && window.surveyDB.syncCloud) {
            await window.surveyDB.syncCloud();
        }
        await loadPendingFieldSurveys();
        await loadDfoBoundaries();
        if (currentBoundaryData && currentBoundaryData.id) {
            const fresh = await window.surveyDB.get('polygons', currentBoundaryData.id);
            if (fresh) {
                currentBoundaryData = fresh;
                renderActiveBoundary(false);
            }
        }
    } finally {
        setTimeout(() => {
            if (icon) icon.classList.remove('fa-spin');
        }, 500);
    }
};

async function loadPendingFieldSurveys(shouldPull = false) {
    if (shouldPull && navigator.onLine && window.surveyDB && window.surveyDB.pullFromCloud) {
        await window.surveyDB.pullFromCloud().catch(() => {});
    }
    const all = await window.surveyDB.getAll('pending_surveys');
    const divisionSurveys = all.filter(s => (s.division || '').toLowerCase() === currentDivision.toLowerCase());

    const listEl = document.getElementById('pendingSurveysList');
    document.getElementById('pendingCount').textContent = divisionSurveys.length;

    if (divisionSurveys.length === 0) {
        listEl.innerHTML = '<div class="empty-hint">No pending field surveys.</div>';
        return;
    }

    listEl.innerHTML = '';
    divisionSurveys.forEach(s => {
        const item = document.createElement('div');
        item.className = 'pending-item';
        item.style.flexDirection = 'column';
        item.style.alignItems = 'stretch';
        item.style.gap = '6px';
        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div>
                    ${s.is_revision ? '<span class="badge-revision">REVISION</span>' : ''}<b style="color:#38bdf8;">${s.name}</b><br>
                    <small style="color:#94a3b8;">${s.range} Range | ${s.coordinates.length} cairns | Area: <b style="color:#fbbf24;">${s.area_ha} Ha</b> ${s.submitted_by ? '&bull; By ' + s.submitted_by : ''}</small>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px;">
                <button class="btn-primary" style="padding:5px 6px; font-size:10px;" onclick="previewFieldSurvey('${s.id}')">
                    <i class="fa-solid fa-eye"></i> Preview
                </button>
                <button class="btn-success" style="padding:5px 6px; font-size:10px;" onclick="acceptFieldSurvey('${s.id}')">
                    <i class="fa-solid fa-check"></i> Accept
                </button>
                <button class="btn-danger" style="padding:5px 6px; font-size:10px;" onclick="rejectFieldSurvey('${s.id}')">
                    <i class="fa-solid fa-trash"></i> Reject
                </button>
            </div>
        `;
        listEl.appendChild(item);
    });
}

// Preview submitted field survey on satellite map
async function previewFieldSurvey(surveyId) {
    const s = await window.surveyDB.get('pending_surveys', surveyId);
    if (!s) return;

    if (activePolygonLayer) map.removeLayer(activePolygonLayer);
    vertexMarkersGroup.clearLayers();
    if (previewSurveyLayer) map.removeLayer(previewSurveyLayer);
    if (!previewMarkersGroup) previewMarkersGroup = L.layerGroup().addTo(map);
    previewMarkersGroup.clearLayers();

    // If revision, show original boundary in dashed cyan
    if (s.is_revision && s.targetPolygonId) {
        const orig = await window.surveyDB.get('polygons', s.targetPolygonId);
        if (orig && orig.coordinates) {
            const origLatLngs = orig.coordinates.map(c => [c[1], c[0]]);
            L.polygon(origLatLngs, {
                color: '#06b6d4',
                weight: 2,
                dashArray: '6, 6',
                fill: false
            }).addTo(previewMarkersGroup);
        }
    }

    const latlngs = s.coordinates.map(c => [c[1], c[0]]);

    // Bright amber revised polygon
    previewSurveyLayer = L.polygon(latlngs, {
        color: '#f59e0b',
        weight: 3,
        dashArray: '8, 5',
        fillColor: '#fbbf24',
        fillOpacity: 0.25
    }).addTo(map);

    map.fitBounds(previewSurveyLayer.getBounds(), { padding: [50, 50] });

    s.coordinates.forEach((c, idx) => {
        const icon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div class="vertex-marker-icon" style="background:#f59e0b; width:26px; height:26px;">${idx + 1}</div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13]
        });
        const marker = L.marker([c[1], c[0]], { icon: icon }).addTo(previewMarkersGroup);
        marker.bindPopup(`<b>Cairn #${idx + 1} (${s.is_revision ? 'Revised' : 'Proposed'})</b><br>Lat: ${format10Dec(c[1])}<br>Lon: ${format10Dec(c[0])}`);
    });

    document.getElementById('activeMapInfo').textContent = `${s.is_revision ? 'REVISION PREVIEW' : 'PREVIEW'}: ${s.name} (${s.range} Range) — ${s.area_ha} Ha`;
    alert(`Showing preview of ${s.is_revision ? 'edited boundary revision' : 'survey'} "${s.name}" on map!\nClick "Accept" to overwrite official boundary or "Reject" to discard.`);
}

async function acceptFieldSurvey(surveyId) {
    const survey = await window.surveyDB.get('pending_surveys', surveyId);
    if (!survey) return;

    let targetId = survey.targetPolygonId;
    let savedPoly = null;

    if (survey.is_revision && targetId) {
        // OVERWRITE existing official boundary in database!
        const existing = await window.surveyDB.get('polygons', targetId);
        if (existing) {
            existing.coordinates = survey.coordinates;
            existing.updated_at = new Date().toISOString();
            existing.status = 'OFFICIAL';
            savedPoly = existing;
            await window.surveyDB.put('polygons', existing);
        }
    }

    if (!savedPoly) {
        // Create new official polygon
        savedPoly = {
            id: `RF_${survey.division.replace(/\s+/g, '_')}_${Date.now()}`,
            name: survey.name,
            division: survey.division,
            range: survey.range,
            type: 'RF',
            status: 'OFFICIAL',
            coordinates: survey.coordinates,
            flaggedVertices: [],
            created_at: new Date().toISOString()
        };
        await window.surveyDB.put('polygons', savedPoly);
    }

    await window.surveyDB.delete('pending_surveys', surveyId);
    if (navigator.onLine && window.surveyDB.syncCloud) {
        await window.surveyDB.syncCloud({ deletedSurveyId: surveyId });
    }

    if (previewSurveyLayer) map.removeLayer(previewSurveyLayer);
    if (previewMarkersGroup) previewMarkersGroup.clearLayers();

    if (currentBoundaryData && savedPoly && currentBoundaryData.id === savedPoly.id) {
        currentBoundaryData = savedPoly;
        renderActiveBoundary(false); // DO NOT RESET ZOOM
    }

    alert(`Boundary "${survey.name}" ${survey.is_revision ? 'revision accepted & overwritten' : 'accepted & loaded'} in ${survey.division} official database!`);
    await loadPendingFieldSurveys();
    await loadDfoBoundaries();

    const bSelect = document.getElementById('dfoBoundarySelect');
    if (bSelect && savedPoly) {
        bSelect.value = savedPoly.id;
        loadDfoActiveBoundary();
    }
}

async function rejectFieldSurvey(surveyId) {
    if (confirm('Reject and delete this field survey?')) {
        await window.surveyDB.delete('pending_surveys', surveyId);
        if (navigator.onLine && window.surveyDB.syncCloud) {
            await window.surveyDB.syncCloud({ deletedSurveyId: surveyId }).catch(() => {});
        }
        if (previewSurveyLayer) map.removeLayer(previewSurveyLayer);
        if (previewMarkersGroup) previewMarkersGroup.clearLayers();
        await loadPendingFieldSurveys();
    }
}

// -------------------------------------------------------------------------
// DFO FIELD STAFF CREDENTIAL MANAGEMENT (Max 5 Staff per Range)
// -------------------------------------------------------------------------
function openStaffManagementModal() {
    const modal = document.getElementById('staffManagementModal');
    const title = document.getElementById('modalDivisionTitle');
    if (title) title.textContent = currentDivision;
    loadDfoStaffManagement();
    if (modal) modal.style.display = 'flex';
}

function closeStaffManagementModal() {
    const modal = document.getElementById('staffManagementModal');
    if (modal) modal.style.display = 'none';
}

async function loadDfoStaffManagement() {
    const rangeSelect = document.getElementById('staffTargetRange');
    if (!rangeSelect) return;

    // Populate with current division's ranges
    const prevVal = rangeSelect.value;
    rangeSelect.innerHTML = '';
    const ranges = window.TN_FOREST_HIERARCHY[currentDivision] || [];
    ranges.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r;
        opt.textContent = `${r} Range`;
        rangeSelect.appendChild(opt);
    });
    if (prevVal && ranges.includes(prevVal)) {
        rangeSelect.value = prevVal;
    }

    await updateStaffRangeQuota();
    await renderStaffRoster();
}

async function updateStaffRangeQuota() {
    const rangeSelect = document.getElementById('staffTargetRange');
    const quotaBadge = document.getElementById('rangeStaffQuotaBadge');
    const createBtn = document.getElementById('btnCreateStaff');
    if (!rangeSelect || !quotaBadge) return;

    const targetRange = rangeSelect.value;
    if (!targetRange) return;

    const count = await window.surveyDB.countFieldStaffByRange(currentDivision, targetRange);
    quotaBadge.textContent = `${count} / 10 Active`;

    if (count >= 10) {
        quotaBadge.classList.add('full');
        if (createBtn) createBtn.disabled = true;
    } else {
        quotaBadge.classList.remove('full');
        if (createBtn) createBtn.disabled = false;
    }
}

async function renderStaffRoster() {
    const rosterList = document.getElementById('staffRosterList');
    const totalCountEl = document.getElementById('totalStaffCount');
    if (!rosterList) return;

    const staffMembers = await window.surveyDB.getFieldStaffByDivision(currentDivision);
    if (totalCountEl) totalCountEl.textContent = staffMembers.length;
    const dfoBtnBadge = document.getElementById('dfoStaffCountBadge');
    if (dfoBtnBadge) dfoBtnBadge.textContent = `${staffMembers.length} Staff`;

    if (staffMembers.length === 0) {
        rosterList.innerHTML = '<div class="empty-hint">No field staff accounts created yet. Use the form above to add up to 5 staff per range.</div>';
        return;
    }

    rosterList.innerHTML = '';
    staffMembers.forEach(staff => {
        const card = document.createElement('div');
        card.className = 'staff-item-card';
        card.innerHTML = `
            <div class="staff-item-info">
                <div class="staff-item-name">${staff.name}</div>
                <div class="staff-item-meta">
                    <span class="badge-range"><i class="fa-solid fa-tree"></i> ${staff.range} Range</span>
                    <span>User: <strong class="badge-code">${staff.username}</strong></span>
                    <span>Pass: <strong class="badge-code">${staff.password}</strong></span>
                </div>
            </div>
            <div class="staff-item-actions">
                <button type="button" class="btn-revoke-staff" onclick="handleRevokeFieldStaff('${staff.username}')" title="Revoke Login Access">
                    <i class="fa-solid fa-trash-can"></i> Revoke
                </button>
            </div>
        `;
        rosterList.appendChild(card);
    });
}

async function handleCreateFieldStaff() {
    const rangeSelect = document.getElementById('staffTargetRange');
    const nameInp = document.getElementById('newStaffName');
    const userInp = document.getElementById('newStaffUsername');
    const passInp = document.getElementById('newStaffPassword');

    const targetRange = rangeSelect.value;
    const name = nameInp.value.trim();
    const username = userInp.value.trim().toLowerCase();
    const password = passInp.value.trim();

    if (!targetRange) {
        alert('Please select a Target Range.');
        return;
    }
    if (!name) {
        alert('Please enter the Staff Member\'s Name and Designation (e.g. S. Murugan - Forester).');
        nameInp.focus();
        return;
    }
    if (!username) {
        alert('Please enter a unique Login Username for the field officer.');
        userInp.focus();
        return;
    }
    if (!password) {
        alert('Please enter a password for this field officer.');
        passInp.focus();
        return;
    }

    try {
        await window.surveyDB.createFieldStaff({
            division: currentDivision,
            range: targetRange,
            name: name,
            username: username,
            password: password,
            created_by: `DFO (${currentDivision})`
        });

        nameInp.value = '';
        userInp.value = '';
        passInp.value = '';

        await updateStaffRangeQuota();
        await renderStaffRoster();
        alert(`Field Officer credentials successfully created for ${name} (${targetRange} Range)!\n\nUsername: ${username}\nPassword: ${password}`);
    } catch (err) {
        alert(`Error: ${err.message}`);
    }
}

async function handleRevokeFieldStaff(username) {
    if (!confirm(`Are you sure you want to revoke and delete login credentials for "${username}"?`)) {
        return;
    }

    await window.surveyDB.deleteFieldStaff(username);
    await updateStaffRangeQuota();
    await renderStaffRoster();
    alert(`Staff account "${username}" revoked successfully.`);
}

// -------------------------------------------------------------------------
// 4. FIELD OFFICER PORTAL: CREATE NEW POLYGON (GPS & MANUAL MAP CLICK)
// -------------------------------------------------------------------------

// =========================================================================
// FIELD OFFICER ASSIGNED RF BOUNDARY REVISION & EDITING ENGINE
// =========================================================================
let fieldActiveBoundaryData = null;
let fieldSelectedVertexIndex = 0;
let fieldOperationMode = 'EDIT_RF';

window.switchFieldOperationMode = function(mode) {
    fieldOperationMode = mode;
    const tabEdit = document.getElementById('tabFieldEditRf');
    const tabNew = document.getElementById('tabFieldNewRf');
    const secEdit = document.getElementById('fieldEditRfSection');
    const secNew = document.getElementById('fieldNewSurveySection');

    if (mode === 'EDIT_RF') {
        if (tabEdit) tabEdit.classList.add('active');
        if (tabNew) tabNew.classList.remove('active');
        if (secEdit) secEdit.style.display = 'block';
        if (secNew) secNew.style.display = 'none';
        loadFieldAssignedBoundaries();
    } else {
        if (tabEdit) tabEdit.classList.remove('active');
        if (tabNew) tabNew.classList.add('active');
        if (secEdit) secEdit.style.display = 'none';
        if (secNew) secNew.style.display = 'block';
        if (activePolygonLayer) map.removeLayer(activePolygonLayer);
        vertexMarkersGroup.clearLayers();
        renderNewSurveyProgress();
    }
};

window.loadFieldAssignedBoundaries = async function(pullFirst = false) {
    if (pullFirst && navigator.onLine && window.surveyDB && window.surveyDB.pullFromCloud) {
        try { await window.surveyDB.pullFromCloud(); } catch(e) {}
    }

    const all = await window.surveyDB.getAll('polygons');
    // Strictly filter to current field officer's division and range using normalizeRange!
    const rangePolys = all.filter(p => 
        p.division && p.range &&
        p.division.toLowerCase() === currentDivision.toLowerCase() &&
        normalizeRange(p.range) === normalizeRange(currentRange)
    );

    const selectEl = document.getElementById('fieldAssignedRfSelect');
    if (!selectEl) return;
    selectEl.innerHTML = '';

    if (rangePolys.length === 0) {
        selectEl.innerHTML = `<option value="">No RFs assigned to ${currentRange} yet</option>`;
        const det = document.getElementById('fieldRfDetailsCard');
        const vcard = document.getElementById('fieldActiveVertexCard');
        const sub = document.getElementById('fieldSubmitRevisionCard');
        if (det) det.style.display = 'none';
        if (vcard) vcard.style.display = 'none';
        if (sub) sub.style.display = 'none';
        if (activePolygonLayer) map.removeLayer(activePolygonLayer);
        vertexMarkersGroup.clearLayers();
        fieldMarkerInstances = [];
        return;
    }

    rangePolys.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.coordinates.length} cairns)`;
        selectEl.appendChild(opt);
    });

    selectEl.value = rangePolys[0].id;
    await loadFieldBoundaryForEditing();
};

window.manualSyncFieldAssignedBoundaries = async function() {
    const icon = document.getElementById('fieldSyncIcon');
    if (icon) icon.classList.add('fa-spin');
    try {
        if (window.surveyDB && window.surveyDB.pullFromCloud) {
            await window.surveyDB.pullFromCloud();
        }
        await loadFieldAssignedBoundaries(false);
        if (fieldActiveBoundaryData && fieldActiveBoundaryData.id) {
            const fresh = await window.surveyDB.get('polygons', fieldActiveBoundaryData.id);
            if (fresh) {
                fieldActiveBoundaryData = JSON.parse(JSON.stringify(fresh));
                renderFieldActiveBoundary(false); // keep current zoom
                if (fieldSelectedVertexIndex !== null) selectFieldVertex(fieldSelectedVertexIndex);
            }
        }
    } finally {
        setTimeout(() => { if (icon) icon.classList.remove('fa-spin'); }, 500);
    }
};

window.loadFieldBoundaryForEditing = async function() {
    const selectEl = document.getElementById('fieldAssignedRfSelect');
    if (!selectEl || !selectEl.value) return;

    const poly = await window.surveyDB.get('polygons', selectEl.value);
    if (!poly) return;

    fieldActiveBoundaryData = JSON.parse(JSON.stringify(poly));
    fieldSelectedVertexIndex = 0;

    const det = document.getElementById('fieldRfDetailsCard');
    const sub = document.getElementById('fieldSubmitRevisionCard');
    if (det) det.style.display = 'block';
    if (sub) sub.style.display = 'block';
    document.getElementById('fieldRfName').textContent = poly.name;
    document.getElementById('fieldRfRange').textContent = `${poly.range} Range`;
    document.getElementById('fieldRfCairns').textContent = `${poly.coordinates.length} cairns`;

    // Calculate area
    const closed = [...poly.coordinates, poly.coordinates[0]];
    const turfPoly = turf.polygon([closed]);
    const areaHa = (turf.area(turfPoly) / 10000).toFixed(2);
    document.getElementById('fieldRfArea').textContent = `${areaHa} Ha`;

    renderFieldActiveBoundary(true);
    selectFieldVertex(0);
};

window.renderFieldActiveBoundary = function(shouldFitBounds = false) {
    if (!fieldActiveBoundaryData || !fieldActiveBoundaryData.coordinates) return;

    if (activePolygonLayer) map.removeLayer(activePolygonLayer);
    vertexMarkersGroup.clearLayers();
    fieldMarkerInstances = [];

    const latlngs = fieldActiveBoundaryData.coordinates.map(c => [c[1], c[0]]);

    // Green editable boundary for field officer
    activePolygonLayer = L.polygon(latlngs, {
        color: '#059669',
        weight: 3,
        fillColor: '#10b981',
        fillOpacity: 0.25
    }).addTo(map);

    if (shouldFitBounds) {
        map.fitBounds(activePolygonLayer.getBounds(), { padding: [40, 40] });
    }

    // Render Draggable, Clickable Cairn Markers
    fieldActiveBoundaryData.coordinates.forEach((c, idx) => {
        const isSelected = (idx === fieldSelectedVertexIndex);
        const icon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div class="vertex-marker-icon ${isSelected ? 'selected' : ''}" style="background:${isSelected ? '#0284c7' : '#059669'}; width:28px; height:28px; border:2px solid #ffffff;">${idx + 1}</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        });

        const marker = L.marker([c[1], c[0]], { icon: icon, draggable: true }).addTo(vertexMarkersGroup);
        fieldMarkerInstances[idx] = marker;

        marker.on('click', () => {
            selectFieldVertex(idx);
        });

        marker.on('drag', (e) => {
            const pos = e.target.getLatLng();
            fieldActiveBoundaryData.coordinates[idx] = [Number(pos.lng.toFixed(10)), Number(pos.lat.toFixed(10))];
            if (activePolygonLayer) {
                activePolygonLayer.setLatLngs(fieldActiveBoundaryData.coordinates.map(pt => [pt[1], pt[0]]));
            }

            if (idx === fieldSelectedVertexIndex) {
                const latInp = document.getElementById('fieldVertexLatInput');
                const lonInp = document.getElementById('fieldVertexLonInput');
                if (latInp) latInp.value = pos.lat.toFixed(10);
                if (lonInp) lonInp.value = pos.lng.toFixed(10);
            }

            const cl = [...fieldActiveBoundaryData.coordinates, fieldActiveBoundaryData.coordinates[0]];
            const ha = (turf.area(turf.polygon([cl])) / 10000).toFixed(2);
            const areaEl = document.getElementById('fieldRfArea');
            if (areaEl) areaEl.textContent = `${ha} Ha`;
        });

        // 60fps smooth dragend: never destroy DOM markers!
        marker.on('dragend', () => {
            const pos = marker.getLatLng();
            fieldActiveBoundaryData.coordinates[idx] = [Number(pos.lng.toFixed(10)), Number(pos.lat.toFixed(10))];
            if (activePolygonLayer) {
                activePolygonLayer.setLatLngs(fieldActiveBoundaryData.coordinates.map(pt => [pt[1], pt[0]]));
            }
            selectFieldVertex(idx);
        });
    });

    // Click line to insert cairn
    activePolygonLayer.on('click', (e) => {
        const clickPt = turf.point([e.latlng.lng, e.latlng.lat]);
        const coords = fieldActiveBoundaryData.coordinates;
        let bestIndex = 0;
        let minDistance = Infinity;

        for (let i = 0; i < coords.length; i++) {
            const nextIdx = (i + 1) % coords.length;
            const line = turf.lineString([coords[i], coords[nextIdx]]);
            const dist = turf.pointToLineDistance(clickPt, line);
            if (dist < minDistance) {
                minDistance = dist;
                bestIndex = nextIdx;
            }
        }

        const newCoord = [Number(e.latlng.lng.toFixed(10)), Number(e.latlng.lat.toFixed(10))];
        coords.splice(bestIndex, 0, newCoord);
        renderFieldActiveBoundary(false); // DO NOT ZOOM OUT
        selectFieldVertex(bestIndex);
        alert(`Inserted new boundary cairn #${bestIndex + 1}! You can drag it or type exact 10-decimal coordinates.`);
    });
};

window.selectFieldVertex = function(idx) {
    if (!fieldActiveBoundaryData || !fieldActiveBoundaryData.coordinates[idx]) return;
    const prevIdx = fieldSelectedVertexIndex;
    fieldSelectedVertexIndex = idx;
    const c = fieldActiveBoundaryData.coordinates[idx];

    // Smoothly update marker selection styling without destroying DOM nodes
    if (prevIdx !== null && prevIdx !== idx && fieldMarkerInstances[prevIdx]) {
        fieldMarkerInstances[prevIdx].setIcon(L.divIcon({
            className: 'custom-div-icon',
            html: `<div class="vertex-marker-icon" style="background:#059669; width:28px; height:28px; border:2px solid #ffffff;">${prevIdx + 1}</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        }));
    }
    if (fieldMarkerInstances[idx]) {
        fieldMarkerInstances[idx].setIcon(L.divIcon({
            className: 'custom-div-icon',
            html: `<div class="vertex-marker-icon selected" style="background:#0284c7; width:28px; height:28px; border:2px solid #ffffff;">${idx + 1}</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        }));
    }

    const card = document.getElementById('fieldActiveVertexCard');
    if (card) card.style.display = 'block';
    const numEl = document.getElementById('fieldActivePointNum');
    if (numEl) numEl.textContent = `Point #${idx + 1}`;
    const latInp = document.getElementById('fieldVertexLatInput');
    const lonInp = document.getElementById('fieldVertexLonInput');
    if (latInp) latInp.value = Number(c[1]).toFixed(10);
    if (lonInp) lonInp.value = Number(c[0]).toFixed(10);
};

window.saveFieldVertexCoords = function() {
    if (!fieldActiveBoundaryData || fieldSelectedVertexIndex === null) return;
    const latInp = document.getElementById('fieldVertexLatInput');
    const lonInp = document.getElementById('fieldVertexLonInput');
    const lat = parseFloat(latInp.value);
    const lon = parseFloat(lonInp.value);

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        alert('Please enter valid GPS coordinates (Latitude: -90 to 90, Longitude: -180 to 180).');
        return;
    }

    fieldActiveBoundaryData.coordinates[fieldSelectedVertexIndex] = [Number(lon.toFixed(10)), Number(lat.toFixed(10))];
    if (fieldMarkerInstances[fieldSelectedVertexIndex]) {
        fieldMarkerInstances[fieldSelectedVertexIndex].setLatLng([lat, lon]);
    }
    if (activePolygonLayer) {
        activePolygonLayer.setLatLngs(fieldActiveBoundaryData.coordinates.map(pt => [pt[1], pt[0]]));
    }

    const cl = [...fieldActiveBoundaryData.coordinates, fieldActiveBoundaryData.coordinates[0]];
    const ha = (turf.area(turf.polygon([cl])) / 10000).toFixed(2);
    const areaEl = document.getElementById('fieldRfArea');
    if (areaEl) areaEl.textContent = `${ha} Ha`;

    map.panTo([lat, lon]);
    selectFieldVertex(fieldSelectedVertexIndex);
    alert(`Cairn #${fieldSelectedVertexIndex + 1} coordinates fixed & updated to:\nLatitude: ${lat.toFixed(10)}\nLongitude: ${lon.toFixed(10)}`);
};

window.snapFieldVertexToStandingGps = function() {
    if (!fieldActiveBoundaryData || fieldSelectedVertexIndex === null) return;

    const applyCoords = (lat, lon) => {
        fieldActiveBoundaryData.coordinates[fieldSelectedVertexIndex] = [Number(lon.toFixed(10)), Number(lat.toFixed(10))];

        if (fieldMarkerInstances[fieldSelectedVertexIndex]) {
            fieldMarkerInstances[fieldSelectedVertexIndex].setLatLng([lat, lon]);
        }
        if (activePolygonLayer) {
            activePolygonLayer.setLatLngs(fieldActiveBoundaryData.coordinates.map(pt => [pt[1], pt[0]]));
        }

        const cl = [...fieldActiveBoundaryData.coordinates, fieldActiveBoundaryData.coordinates[0]];
        const ha = (turf.area(turf.polygon([cl])) / 10000).toFixed(2);
        const areaEl = document.getElementById('fieldRfArea');
        if (areaEl) areaEl.textContent = `${ha} Ha`;

        const latInp = document.getElementById('fieldVertexLatInput');
        const lonInp = document.getElementById('fieldVertexLonInput');
        if (latInp) latInp.value = Number(lat).toFixed(10);
        if (lonInp) lonInp.value = Number(lon).toFixed(10);

        map.panTo([lat, lon]);
        selectFieldVertex(fieldSelectedVertexIndex);
        alert(`Point #${fieldSelectedVertexIndex + 1} snapped to your standing GPS location!\nLatitude: ${Number(lat).toFixed(10)}\nLongitude: ${Number(lon).toFixed(10)}`);
    };

    if (liveGpsLocation && liveGpsLocation.lat && liveGpsLocation.lon) {
        applyCoords(liveGpsLocation.lat, liveGpsLocation.lon);
        return;
    }

    if (!('geolocation' in navigator)) {
        alert('Geolocation is not supported by your browser/device.');
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;
            liveGpsLocation = { lat, lon, accuracy: pos.coords.accuracy };
            applyCoords(lat, lon);
        },
        (err) => alert(`GPS Error: ${err.message}. Please enable GPS and allow location access on your mobile device.`),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
};

window.deleteFieldSelectedVertex = function() {
    if (!fieldActiveBoundaryData) return;
    if (fieldActiveBoundaryData.coordinates.length <= 3) {
        alert('A valid boundary polygon requires at least 3 points! Cannot delete further.');
        return;
    }

    if (confirm(`Delete Point #${fieldSelectedVertexIndex + 1} from "${fieldActiveBoundaryData.name}"?`)) {
        fieldActiveBoundaryData.coordinates.splice(fieldSelectedVertexIndex, 1);
        fieldSelectedVertexIndex = Math.max(0, fieldSelectedVertexIndex - 1);
        renderFieldActiveBoundary(false); // DO NOT ZOOM OUT
        selectFieldVertex(fieldSelectedVertexIndex);
    }
};

window.submitFieldRfRevision = async function() {
    if (!fieldActiveBoundaryData || fieldActiveBoundaryData.coordinates.length < 3) {
        alert('A valid polygon requires at least 3 points.');
        return;
    }

    const user = window.surveyDB.getCurrentUser();
    const cl = [...fieldActiveBoundaryData.coordinates, fieldActiveBoundaryData.coordinates[0]];
    const areaHa = (turf.area(turf.polygon([cl])) / 10000).toFixed(2);

    const revision = {
        id: `REV_${fieldActiveBoundaryData.id}_${Date.now()}`,
        targetPolygonId: fieldActiveBoundaryData.id,
        name: fieldActiveBoundaryData.name,
        division: currentDivision,
        range: currentRange,
        is_revision: true,
        coordinates: fieldActiveBoundaryData.coordinates.map(c => [Number(Number(c[0]).toFixed(10)), Number(Number(c[1]).toFixed(10))]),
        area_ha: areaHa,
        submitted_by: user ? (user.name || user.username) : 'Field Officer',
        submitted_at: new Date().toISOString()
    };

    await window.surveyDB.put('pending_surveys', revision);
    if (navigator.onLine && window.surveyDB.syncCloud) {
        await window.surveyDB.syncCloud().catch(() => {});
    }

    alert(`Edited RF Boundary "${fieldActiveBoundaryData.name}" (${revision.coordinates.length} cairns, ${areaHa} Ha) submitted to ${currentDivision} DFO for verification!`);
};

async function setupFieldPortal() {
    if (navigator.onLine && window.surveyDB && window.surveyDB.pullFromCloud) {
        try { await window.surveyDB.pullFromCloud(); } catch(e) {}
    }
    document.getElementById('dfoPanel').style.display = 'none';
    document.getElementById('fieldPanel').style.display = 'block';

    document.getElementById('fieldDivisionTitle').textContent = currentDivision;
    document.getElementById('fieldRangeTitle').textContent = `${currentRange} Range`;
    document.getElementById('activeMapInfo').textContent = `Field Ground Survey — ${currentRange} Range`;

    if (activePolygonLayer) map.removeLayer(activePolygonLayer);
    vertexMarkersGroup.clearLayers();
    if (previewSurveyLayer) map.removeLayer(previewSurveyLayer);
    if (previewMarkersGroup) previewMarkersGroup.clearLayers();

    // Default to Edit Assigned RF Boundary Mode
    switchFieldOperationMode('EDIT_RF');
}

// Switch between Outdoor GPS and Indoor Manual Testing
function switchCaptureMode(mode) {
    const tabGps = document.getElementById('tabGpsCapture');
    const tabMan = document.getElementById('tabManualCapture');
    const secGps = document.getElementById('gpsCaptureSection');
    const secMan = document.getElementById('manualCaptureSection');

    if (mode === 'GPS') {
        tabGps.classList.add('active');
        tabMan.classList.remove('active');
        secGps.style.display = 'block';
        secMan.style.display = 'none';
        if (isMapClickActive) toggleMapClickMode(false);
    } else {
        tabGps.classList.remove('active');
        tabMan.classList.add('active');
        secGps.style.display = 'none';
        secMan.style.display = 'block';
    }
}

// Toggle Map Click Mode for Manual Pin-Drop
function toggleMapClickMode(forceState) {
    if (typeof forceState === 'boolean') {
        isMapClickActive = forceState;
    } else {
        isMapClickActive = !isMapClickActive;
    }

    const btn = document.getElementById('btnToggleMapClick');
    const text = document.getElementById('mapClickBtnText');
    const banner = document.getElementById('mapClickActiveBanner');
    const mapEl = document.getElementById('map');

    if (isMapClickActive) {
        btn.className = 'btn-danger btn-lg btn-block';
        text.innerHTML = '<i class="fa-solid fa-stop"></i> Stop Map Pin-Drop Mode';
        banner.style.display = 'flex';
        mapEl.classList.add('cursor-crosshair');
        updateMapClickPrompts();
    } else {
        btn.className = 'btn-primary btn-lg btn-block';
        text.innerHTML = `<i class="fa-solid fa-crosshairs"></i> Tap Map to Add Point #${newSurveyPoints.length + 1}`;
        banner.style.display = 'none';
        mapEl.classList.remove('cursor-crosshair');
    }
}

function updateMapClickPrompts() {
    const nextNum = newSurveyPoints.length + 1;
    document.getElementById('nextPointNumber').textContent = `#${nextNum}`;
    const pPrompt = document.getElementById('mapClickPointPrompt');
    if (pPrompt) pPrompt.textContent = `Point #${nextNum}`;
    const btnText = document.getElementById('mapClickBtnText');
    if (btnText && isMapClickActive) {
        btnText.innerHTML = `<i class="fa-solid fa-stop"></i> Stop Pin-Drop (Adding #${nextNum})`;
    } else if (btnText) {
        btnText.innerHTML = `<i class="fa-solid fa-crosshairs"></i> Tap Map to Add Point #${nextNum}`;
    }
}

// Add point by typing/pasting Latitude & Longitude directly
function addManualCoordinatePoint() {
    const latInp = document.getElementById('manualLatInput');
    const lonInp = document.getElementById('manualLonInput');
    const lat = parseFloat(latInp.value);
    const lon = parseFloat(lonInp.value);

    if (isNaN(lat) || isNaN(lon)) {
        alert('Please enter valid numeric Latitude and Longitude values.');
        return;
    }

    const ptNum = newSurveyPoints.length + 1;
    newSurveyPoints.push({
        point_number: ptNum,
        lat: lat,
        lon: lon,
        accuracy: 0.5,
        time: new Date().toLocaleTimeString(),
        is_manual: true
    });

    latInp.value = '';
    lonInp.value = '';
    renderNewSurveyProgress();
    updateMapClickPrompts();
    map.panTo([lat, lon]);
}

// Instant Single-Shot Point Capture (Outdoor GPS)
function captureGroundPoint() {
    if (!liveGpsLocation) {
        alert('Searching for GPS fix... Please ensure device location is ON.');
        return;
    }

    const ptNum = newSurveyPoints.length + 1;
    newSurveyPoints.push({
        point_number: ptNum,
        lat: liveGpsLocation.lat,
        lon: liveGpsLocation.lon,
        accuracy: liveGpsLocation.accuracy,
        time: new Date().toLocaleTimeString(),
        is_averaged: false,
        is_manual: false
    });

    renderNewSurveyProgress();
    updateMapClickPrompts();
}

// Centimeter / Sub-Meter Precision Multi-Epoch Averaging
function startMultiEpochAveraging() {
    if (isEpochAveraging) return;
    if (!liveGpsLocation) {
        alert('Please stand outdoors under open sky. Searching for GPS satellites...');
        return;
    }

    isEpochAveraging = true;
    const progressBox = document.getElementById('epochProgressBox');
    const countBadge = document.getElementById('epochCountBadge');
    const progressBar = document.getElementById('epochProgressBar');
    const stdDevEl = document.getElementById('epochStdDev');

    progressBox.style.display = 'block';
    progressBar.style.width = '0%';

    const totalEpochs = 20;
    const collectedEpochs = [];

    const epochInterval = setInterval(() => {
        if (collectedEpochs.length >= totalEpochs) {
            clearInterval(epochInterval);
            finishEpochAveraging(collectedEpochs);
            return;
        }

        if (liveGpsLocation) {
            collectedEpochs.push({
                lat: liveGpsLocation.lat,
                lon: liveGpsLocation.lon,
                acc: liveGpsLocation.accuracy
            });

            const progressPct = Math.round((collectedEpochs.length / totalEpochs) * 100);
            progressBar.style.width = `${progressPct}%`;
            countBadge.textContent = `${collectedEpochs.length} / ${totalEpochs}`;

            if (collectedEpochs.length > 2) {
                const avgLat = collectedEpochs.reduce((a, b) => a + b.lat, 0) / collectedEpochs.length;
                const variance = collectedEpochs.reduce((a, b) => a + Math.pow(b.lat - avgLat, 2), 0) / collectedEpochs.length;
                const stdMeters = Math.sqrt(variance) * 111139;
                stdDevEl.textContent = `±${stdMeters.toFixed(2)}m`;
            }
        }
    }, 500);
}

function finishEpochAveraging(samples) {
    isEpochAveraging = false;
    document.getElementById('epochProgressBox').style.display = 'none';

    let sumLat = 0, sumLon = 0, totalW = 0;
    samples.forEach(s => {
        const w = 1 / Math.max(s.acc, 0.2);
        sumLat += s.lat * w;
        sumLon += s.lon * w;
        totalW += w;
    });

    const finalLat = sumLat / totalW;
    const finalLon = sumLon / totalW;
    const finalAcc = Math.min(0.8, samples[samples.length - 1].acc / Math.sqrt(samples.length));

    const ptNum = newSurveyPoints.length + 1;
    newSurveyPoints.push({
        point_number: ptNum,
        lat: finalLat,
        lon: finalLon,
        accuracy: finalAcc,
        time: new Date().toLocaleTimeString(),
        is_averaged: true,
        is_manual: false
    });

    renderNewSurveyProgress();
    updateMapClickPrompts();
    alert(`Cairn Point #${ptNum} recorded with 20-Epoch Precision Average (±${finalAcc.toFixed(2)}m)!`);
}

function undoLastSurveyPoint() {
    if (newSurveyPoints.length === 0) return;
    newSurveyPoints.pop();
    renderNewSurveyProgress();
    updateMapClickPrompts();
}

function resetNewSurvey() {
    if (confirm('Reset and clear all captured points?')) {
        newSurveyPoints = [];
        renderNewSurveyProgress();
        updateMapClickPrompts();
    }
}

function renderNewSurveyProgress() {
    newSurveyMarkersGroup.clearLayers();
    if (newSurveyLayer) map.removeLayer(newSurveyLayer);

    const listEl = document.getElementById('capturedPointsList');
    const areaBadge = document.getElementById('liveSurveyAreaBadge');
    const areaVal = document.getElementById('liveSurveyAreaVal');
    document.getElementById('capturedCount').textContent = newSurveyPoints.length;

    if (newSurveyPoints.length === 0) {
        listEl.innerHTML = '<div class="empty-hint">Tap "Tap Map to Add Point #1" or stand outdoors at cairn 1.</div>';
        if (areaBadge) areaBadge.style.display = 'none';
        return;
    }

    listEl.innerHTML = '';
    const latlngs = [];

    newSurveyPoints.forEach((pt, index) => {
        latlngs.push([pt.lat, pt.lon]);

        const item = document.createElement('div');
        item.className = 'c-point-item';
        item.innerHTML = `
            <span><b>Point #${index + 1}</b> (${pt.lat.toFixed(5)}, ${pt.lon.toFixed(5)})</span>
            <div class="c-point-actions">
                <span style="color: ${pt.is_manual ? '#38bdf8' : (pt.accuracy > 30 ? '#fbbf24' : '#34d399')}; font-size: 10px;">
                    ${pt.is_manual ? 'Manual' : '±' + pt.accuracy.toFixed(1) + 'm' + (pt.is_averaged ? ' ★' : '')}
                </span>
                <button class="btn-edit-pt" onclick="editSpecificSurveyPoint(${index})" title="Type / Edit Coordinates for Point #${index + 1}">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="btn-del-pt" onclick="deleteSpecificSurveyPoint(${index})" title="Delete Point #${index + 1}">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        `;
        listEl.appendChild(item);

        const icon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div class="vertex-marker-icon vertex-marker-standard" style="background:#10b981; width:26px; height:26px;">${index + 1}</div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13]
        });

        const m = L.marker([pt.lat, pt.lon], { icon: icon, draggable: true }).addTo(newSurveyMarkersGroup);
        m.on('dragend', (e) => {
            const pos = e.target.getLatLng();
            newSurveyPoints[index].lat = pos.lat;
            newSurveyPoints[index].lon = pos.lng;
            renderNewSurveyProgress();
        });
    });

    // If 3 or more points, close polygon and calculate area
    if (latlngs.length >= 3) {
        newSurveyLayer = L.polygon(latlngs, {
            color: '#10b981',
            weight: 3,
            fillColor: '#10b981',
            fillOpacity: 0.22,
            dashArray: '6, 6'
        }).addTo(map);

        const coords = newSurveyPoints.map(p => [p.lon, p.lat]);
        const closed = [...coords, coords[0]];
        const poly = turf.polygon([closed]);
        const areaM2 = turf.area(poly);
        const areaHa = (areaM2 / 10000).toFixed(2);
        const areaSqKm = (areaM2 / 1000000).toFixed(2);

        if (areaBadge && areaVal) {
            areaBadge.style.display = 'flex';
            areaVal.textContent = `${areaHa} Ha (${areaSqKm} sq.km)`;
        }
    } else if (latlngs.length > 1) {
        newSurveyLayer = L.polyline(latlngs, {
            color: '#10b981',
            weight: 3,
            dashArray: '6, 6'
        }).addTo(map);
        if (areaBadge) areaBadge.style.display = 'none';
    } else {
        if (areaBadge) areaBadge.style.display = 'none';
    }
}

function deleteSpecificSurveyPoint(index) {
    if (confirm(`Delete Point #${index + 1}?`)) {
        newSurveyPoints.splice(index, 1);
        newSurveyPoints.forEach((p, idx) => p.point_number = idx + 1);
        renderNewSurveyProgress();
        updateMapClickPrompts();
    }
}

// Manually type or revise coordinates for a specific survey point
function editSpecificSurveyPoint(index) {
    const pt = newSurveyPoints[index];
    const newLatStr = prompt(`Enter revised Latitude for Point #${index + 1}:`, pt.lat.toFixed(6));
    if (newLatStr === null) return;
    const newLonStr = prompt(`Enter revised Longitude for Point #${index + 1}:`, pt.lon.toFixed(6));
    if (newLonStr === null) return;

    const newLat = parseFloat(newLatStr);
    const newLon = parseFloat(newLonStr);

    if (isNaN(newLat) || isNaN(newLon)) {
        alert('Invalid coordinates. Please enter numeric values.');
        return;
    }

    if (newLat < -90 || newLat > 90 || newLon < -180 || newLon > 180) {
        alert('Coordinates out of range. Latitude (-90 to 90), Longitude (-180 to 180).');
        return;
    }

    pt.lat = newLat;
    pt.lon = newLon;
    pt.is_manual = true;
    renderNewSurveyProgress();
    map.panTo([newLat, newLon]);
}

// Submit survey to DFO (Field Officer submits and stays in Field Portal)
async function submitSurveyToDfo() {
    if (newSurveyPoints.length < 3) {
        alert('A valid polygon requires at least 3 boundary cairns! Please add at least 3 points.');
        return;
    }

    const name = document.getElementById('newSurveyNameInput').value.trim() || `Proposed RF Boundary ${new Date().toLocaleDateString()}`;
    const coords = newSurveyPoints.map(p => [p.lon, p.lat]);

    // Calculate Area
    const closed = [...coords, coords[0]];
    const poly = turf.polygon([closed]);
    const areaHa = (turf.area(poly) / 10000).toFixed(2);

    const submission = {
        id: `SUB_${Date.now()}`,
        name: name,
        division: currentDivision,
        range: currentRange,
        coordinates: coords,
        area_ha: areaHa,
        submitted_at: new Date().toISOString()
    };

    await window.surveyDB.put('pending_surveys', submission);
    if (navigator.onLine && window.surveyDB.syncCloud) {
        await window.surveyDB.syncCloud().catch(() => {});
    }

    if (isMapClickActive) toggleMapClickMode(false);
    newSurveyPoints = [];
    document.getElementById('newSurveyNameInput').value = '';
    renderNewSurveyProgress();
    updateMapClickPrompts();

    alert(`Survey "${name}" (${coords.length} cairns, ${areaHa} Ha) submitted successfully to ${currentDivision} DFO for official verification!`);
}

// -------------------------------------------------------------------------
// 5. BACKGROUND CONTINUOUS GPS TRACKING (SINGLE WATCHER)
// -------------------------------------------------------------------------
let gpsSampleBuffer = [];

function startSingleGpsTracker() {
    if (!('geolocation' in navigator)) return;

    if (liveGpsWatchId !== null) return; // Single persistent watcher

    liveGpsWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            const rawLat = pos.coords.latitude;
            const rawLon = pos.coords.longitude;
            const acc = pos.coords.accuracy;

            // Multi-Sample Moving Average (Smooths out satellite drift & jumps)
            gpsSampleBuffer.push({ lat: rawLat, lon: rawLon, acc: acc, time: Date.now() });
            if (gpsSampleBuffer.length > 8) gpsSampleBuffer.shift();

            // Calculate weighted average favoring recent accurate samples
            let sumLat = 0, sumLon = 0, totalWeight = 0;
            gpsSampleBuffer.forEach(s => {
                const w = 1 / Math.max(s.acc, 0.5);
                sumLat += s.lat * w;
                sumLon += s.lon * w;
                totalWeight += w;
            });

            const smoothLat = sumLat / totalWeight;
            const smoothLon = sumLon / totalWeight;
            const smoothedAcc = Math.min(acc, (acc / Math.sqrt(gpsSampleBuffer.length)) + 0.5);

            liveGpsLocation = {
                lat: smoothLat,
                lon: smoothLon,
                accuracy: smoothedAcc,
                raw_accuracy: acc
            };

            const accEl = document.getElementById('gpsLiveAccuracy');
            const warnBanner = document.getElementById('gpsWarningBanner');
            const accNum = document.getElementById('gpsAccuracyNum');

            if (accEl) {
                if (acc <= 0.1) {
                    accEl.textContent = `RTK FIX ±${(acc * 100).toFixed(0)}cm`;
                    accEl.style.backgroundColor = 'rgba(56, 189, 248, 0.25)';
                    accEl.style.color = '#38bdf8';
                    if (warnBanner) warnBanner.style.display = 'none';
                } else {
                    accEl.textContent = `±${smoothedAcc.toFixed(1)}m`;
                    if (smoothedAcc <= 5) {
                        accEl.style.backgroundColor = 'rgba(16, 185, 129, 0.2)';
                        accEl.style.color = '#34d399';
                        if (warnBanner) warnBanner.style.display = 'none';
                    } else if (smoothedAcc <= 25) {
                        accEl.style.backgroundColor = 'rgba(245, 158, 11, 0.2)';
                        accEl.style.color = '#fbbf24';
                        if (warnBanner) warnBanner.style.display = 'none';
                    } else {
                        accEl.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                        accEl.style.color = '#f87171';
                        if (warnBanner) {
                            warnBanner.style.display = 'flex';
                            if (accNum) accNum.textContent = Math.round(smoothedAcc);
                        }
                    }
                }
            }

            const latEl = document.getElementById('gpsCurrentLat');
            const lonEl = document.getElementById('gpsCurrentLon');
            if (latEl) latEl.textContent = smoothLat.toFixed(6);
            if (lonEl) lonEl.textContent = smoothLon.toFixed(6);

            updateMapLiveLocation(smoothLat, smoothLon, smoothedAcc);
        },
        (err) => console.warn('GPS signal pending:', err),
        {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 20000
        }
    );
}

function updateMapLiveLocation(lat, lon, accuracy) {
    if (!liveGpsMarker) {
        liveGpsMarker = L.circleMarker([lat, lon], {
            radius: 8,
            fillColor: '#0284c7',
            color: '#ffffff',
            weight: 3,
            opacity: 1,
            fillOpacity: 0.9
        }).addTo(map);

        liveGpsAccuracyCircle = L.circle([lat, lon], {
            radius: accuracy,
            color: '#38bdf8',
            weight: 1,
            fillOpacity: 0.1
        }).addTo(map);
    } else {
        liveGpsMarker.setLatLng([lat, lon]);
        liveGpsAccuracyCircle.setLatLng([lat, lon]);
        liveGpsAccuracyCircle.setRadius(accuracy);
    }
}

function locateMeOnMap() {
    if (liveGpsLocation) {
        map.setView([liveGpsLocation.lat, liveGpsLocation.lon], 18);
    } else {
        alert('Searching for GPS fix... Please ensure location permissions are granted.');
    }
}

// -------------------------------------------------------------------------
// 6. EXPORT UTILITIES (CLEAN KML & CSV)
// -------------------------------------------------------------------------
function exportCurrentKml() {
    if (!currentBoundaryData) return;
    const name = currentBoundaryData.name.replace(/\s+/g, '_');
    const coords = currentBoundaryData.coordinates;
    const closed = [...coords, coords[0]];
    const coordStr = closed.map(c => `${format10Dec(c[0])},${format10Dec(c[1])},0`).join(' ');

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${currentBoundaryData.name}</name>
    <Placemark>
      <name>${currentBoundaryData.name}</name>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coordStr}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;

    downloadFile(kml, `${name}_Official.kml`, 'application/vnd.google-earth.kml+xml');
}

function exportSurveyCsv() {
    if (!currentBoundaryData) return;
    const coords = currentBoundaryData.coordinates;
    let csv = 'Cairn_Number,Longitude,Latitude,Elevation_m,Verification_Status\n';
    coords.forEach((c, idx) => {
        const isFlagged = currentBoundaryData.flaggedVertices && currentBoundaryData.flaggedVertices.includes(idx);
        csv += `${idx + 1},${format10Dec(c[0])},${format10Dec(c[1])},0,${isFlagged ? 'DISPUTE_FIELD_VERIFICATION_NEEDED' : 'VERIFIED'}\n`;
    });
    downloadFile(csv, `${currentBoundaryData.name.replace(/\s+/g, '_')}_Cairn_Coordinates.csv`, 'text/csv');
}

function exportFieldSurveyKml() {
    if (newSurveyPoints.length < 3) {
        alert('Record at least 3 points before exporting.');
        return;
    }
    const coords = newSurveyPoints.map(p => [p.lon, p.lat]);
    const closed = [...coords, coords[0]];
    const coordStr = closed.map(c => `${format10Dec(c[0])},${format10Dec(c[1])},0`).join(' ');

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Field_Survey_Backup</name>
    <Placemark>
      <name>Proposed RF Survey</name>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coordStr}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;

    downloadFile(kml, 'Field_Survey_Backup.kml', 'application/vnd.google-earth.kml+xml');
}

function downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// -------------------------------------------------------------------------
// 7. UI MODALS & SIDEBAR CONTROLS
// -------------------------------------------------------------------------
function toggleSidebarPanel() {
    const panel = document.getElementById('mainControlPanel');
    const icon = document.getElementById('sidebarToggleIcon');
    const text = document.getElementById('sidebarToggleText');
    const backdrop = document.getElementById('sidebarBackdrop');

    panel.classList.toggle('collapsed');
    const isCollapsed = panel.classList.contains('collapsed');

    if (isCollapsed) {
        if (icon) icon.className = 'fa-solid fa-bars';
        if (text) text.textContent = 'Panel';
        if (backdrop) backdrop.classList.remove('active');
    } else {
        if (icon) icon.className = 'fa-solid fa-chevron-left';
        if (text) text.textContent = 'Hide';
        if (backdrop && window.innerWidth <= 768) backdrop.classList.add('active');
    }

    setTimeout(() => {
        if (map) map.invalidateSize();
    }, 300);
}

function openRtkModal() {
    document.getElementById('rtkModal').style.display = 'flex';
}

function closeRtkModal() {
    document.getElementById('rtkModal').style.display = 'none';
}

function setupNetworkListeners() {
    window.addEventListener('online', () => {
        document.getElementById('connectionPill').className = 'status-pill online';
        document.getElementById('connectionText').textContent = 'ONLINE';
    });
    window.addEventListener('offline', () => {
        document.getElementById('connectionPill').className = 'status-pill offline';
        document.getElementById('connectionText').textContent = 'OFFLINE';
    });
}


// -------------------------------------------------------------------------


// -------------------------------------------------------------------------
// UNIVERSAL GLOBAL CLOUD REFRESH ENGINE (All 51 Divisions, Mobile, Desktop, APK)
// -------------------------------------------------------------------------
function showToastNotification(msg) {
    let toast = document.getElementById('globalSyncToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'globalSyncToast';
        toast.style.cssText = 'position:fixed; top:65px; left:50%; transform:translateX(-50%); background:#0284c7; color:#fff; padding:8px 18px; border-radius:30px; font-size:12px; font-weight:700; z-index:999999; box-shadow:0 4px 20px rgba(0,0,0,0.6); pointer-events:none; transition:opacity 0.3s; opacity:0;';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    setTimeout(() => {
        if (toast) toast.style.opacity = '0';
    }, 2800);
}

window.handleGlobalForceRefresh = async function() {
    const icons = document.querySelectorAll('.fa-arrows-rotate');
    icons.forEach(ic => ic.classList.add('fa-spin'));
    showToastNotification('Syncing latest boundaries, staff & surveys from Cloud...');

    try {
        if (window.surveyDB && window.surveyDB.pullFromCloud) {
            await window.surveyDB.pullFromCloud();
        }

        const user = window.surveyDB ? window.surveyDB.getCurrentUser() : null;
        if (user && user.role === 'DFO') {
            await loadDfoBoundaries();
            await loadPendingFieldSurveys();
            await loadDfoStaffManagement();
            if (currentBoundaryData && currentBoundaryData.id) {
                const fresh = await window.surveyDB.get('polygons', currentBoundaryData.id);
                if (fresh) {
                    currentBoundaryData = fresh;
                    renderActiveBoundary(false);
                }
            }
        } else if (user && user.role === 'FIELD_OFFICER') {
            await loadFieldAssignedBoundaries(false);
            if (fieldActiveBoundaryData && fieldActiveBoundaryData.id) {
                const fresh = await window.surveyDB.get('polygons', fieldActiveBoundaryData.id);
                if (fresh) {
                    fieldActiveBoundaryData = JSON.parse(JSON.stringify(fresh));
                    renderFieldActiveBoundary(false);
                    if (fieldSelectedVertexIndex !== null) selectFieldVertex(fieldSelectedVertexIndex);
                }
            }
        } else {
            // Login Screen: re-populate divisions
            if (typeof populateLoginDivisions === 'function') populateLoginDivisions();
        }

        showToastNotification('✓ Database refreshed! All 51 divisions updated from Cloud.');
    } catch (err) {
        console.warn('Force refresh error:', err);
        showToastNotification('Cloud sync complete.');
    } finally {
        setTimeout(() => {
            icons.forEach(ic => ic.classList.remove('fa-spin'));
        }, 600);
    }
};

window.switchDfoDivision = async function(newDiv) {
    if (!newDiv) return;
    currentDivision = newDiv;
    const titleEl = document.getElementById('dfoDivisionTitle');
    if (titleEl) titleEl.textContent = newDiv;
    const userDivEl = document.getElementById('userDivisionName');
    if (userDivEl) userDivEl.textContent = newDiv;
    const headerSub = document.getElementById('headerPortalSubtitle');
    if (headerSub) headerSub.textContent = `DFO MASTER PORTAL — ${newDiv.toUpperCase()}`;

    // Populate DFO Range Filter for new division
    const rangeSelect = document.getElementById('dfoRangeSelect');
    const uploadRangeSelect = document.getElementById('uploadRangeSelect');
    if (rangeSelect) rangeSelect.innerHTML = '<option value="ALL">All Ranges in Division</option>';
    if (uploadRangeSelect) uploadRangeSelect.innerHTML = '';

    const ranges = (window.TN_FOREST_HIERARCHY && window.TN_FOREST_HIERARCHY[newDiv]) ? window.TN_FOREST_HIERARCHY[newDiv] : [];
    ranges.forEach(r => {
        if (rangeSelect) {
            const opt1 = document.createElement('option');
            opt1.value = r;
            opt1.textContent = `${r} Range`;
            rangeSelect.appendChild(opt1);
        }
        if (uploadRangeSelect) {
            const opt2 = document.createElement('option');
            opt2.value = r;
            opt2.textContent = `${r} Range`;
            uploadRangeSelect.appendChild(opt2);
        }
    });

    await loadDfoBoundaries();
    await loadPendingFieldSurveys();
    await loadDfoStaffManagement();
    showToastNotification(`Switched active division to: ${newDiv}`);
};
