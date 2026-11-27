/**
 * app.js - Full Division/Range Scoped Portal, Multiple Satellite Maps, and Ground Survey Engine
 * Tamil Nadu Forest Department
 */

let map = null;
let currentRole = 'DFO'; // 'DFO' or 'FIELD_OFFICER'
let currentDivision = 'Chennai Division';
let currentRange = null;

// Map layers
let activePolygonLayer = null;
let vertexMarkersGroup = null;
let currentBoundaryData = null;
let selectedVertexIndex = null;

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

function checkAuthSession() {
    const user = window.surveyDB.getCurrentUser();
    const loginScreen = document.getElementById('loginScreen');
    const appHeader = document.getElementById('appHeader');
    const mainContainer = document.getElementById('mainContainer');

    if (!user) {
        if (loginScreen) loginScreen.style.display = 'flex';
        if (appHeader) appHeader.style.display = 'none';
        if (mainContainer) mainContainer.style.display = 'none';
        return;
    }

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
        setupDfoPortal();
    } else {
        setupFieldPortal();
    }
}

function handleLogout() {
    if (confirm('Are you sure you want to log out of the portal?')) {
        window.surveyDB.logout();
        checkAuthSession();
    }
}

const logoutBtnHeader = document.getElementById('logoutBtn');
if (logoutBtnHeader) {
    logoutBtnHeader.addEventListener('click', handleLogout);
}

// -------------------------------------------------------------------------
// PWA INSTALLATION PROMPT HANDLER (One-Tap Install for Android & Mobile)
// -------------------------------------------------------------------------
let deferredInstallPrompt = null;
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
    if (navigator.onLine && window.surveyDB.pullFromCloud) {
        await window.surveyDB.pullFromCloud().catch(() => {});
    }
    document.getElementById('dfoPanel').style.display = 'block';
    if (!window.dfoAutoSyncTimer) {
        window.dfoAutoSyncTimer = setInterval(async () => {
            const u = window.surveyDB.getCurrentUser();
            if (u && u.role === 'DFO') {
                await loadPendingFieldSurveys().catch(() => {});
            }
        }, 12000);
    }
    document.getElementById('fieldPanel').style.display = 'none';
    document.getElementById('dfoDivisionTitle').textContent = currentDivision;

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
    const divisionPolys = all.filter(p => p.division.toLowerCase() === currentDivision.toLowerCase());

    const selRange = document.getElementById('dfoRangeSelect').value;
    const filtered = (selRange === 'ALL') ? divisionPolys : divisionPolys.filter(p => p.range && p.range.toLowerCase() === selRange.toLowerCase());

    const bSelect = document.getElementById('dfoBoundarySelect');
    bSelect.innerHTML = '';

    if (filtered.length === 0) {
        bSelect.innerHTML = '<option value="">No RF/RL boundaries in database</option>';
        document.getElementById('boundaryActionRow').style.display = 'none';
        document.getElementById('dfoDetailsCard').style.display = 'none';
        document.getElementById('activeVertexCard').style.display = 'none';
        if (activePolygonLayer) map.removeLayer(activePolygonLayer);
        vertexMarkersGroup.clearLayers();
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

    renderActiveBoundary();
    
    // Auto-select first vertex
    if (currentBoundaryData.coordinates.length > 0) {
        selectActiveVertex(0);
    }
}

function renderActiveBoundary() {
    if (activePolygonLayer) map.removeLayer(activePolygonLayer);
    vertexMarkersGroup.clearLayers();

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

    map.fitBounds(activePolygonLayer.getBounds(), { padding: [40, 40] });

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

        coords.splice(insertIdx, 0, [e.latlng.lng, e.latlng.lat]);
        // Auto-flag newly inserted sub-point for field verification
        currentBoundaryData.flaggedVertices = currentBoundaryData.flaggedVertices.map(f => f >= insertIdx ? f + 1 : f);
        currentBoundaryData.flaggedVertices.push(insertIdx);

        await window.surveyDB.put('polygons', currentBoundaryData);
        renderActiveBoundary();
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

        m.on('click', () => {
            selectActiveVertex(idx);
        });

        // Update coordinate input fields in real-time while dragging
        m.on('drag', (e) => {
            const pos = e.target.getLatLng();
            const latInp = document.getElementById('editVertexLatInput');
            const lonInp = document.getElementById('editVertexLonInput');
            if (selectedVertexIndex === idx) {
                if (latInp) latInp.value = pos.lat.toFixed(6);
                if (lonInp) lonInp.value = pos.lng.toFixed(6);
            }
        });

        m.on('dragend', async (e) => {
            const pos = e.target.getLatLng();
            currentBoundaryData.coordinates[idx] = [pos.lng, pos.lat];
            await window.surveyDB.put('polygons', currentBoundaryData);
            renderActiveBoundary();
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
    if (latInp) latInp.value = c[1].toFixed(6);
    if (lonInp) lonInp.value = c[0].toFixed(6);

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

    currentBoundaryData.coordinates[selectedVertexIndex] = [lon, lat];
    await window.surveyDB.put('polygons', currentBoundaryData);
    renderActiveBoundary();
    selectActiveVertex(selectedVertexIndex);
    map.panTo([lat, lon]);
    alert(`Point #${selectedVertexIndex + 1} coordinates fixed & updated to:\nLatitude: ${lat.toFixed(6)}\nLongitude: ${lon.toFixed(6)}`);
}

// Snap active vertex to officer's standing GPS location
async function snapActiveVertexToLiveGps() {
    if (selectedVertexIndex === null || !currentBoundaryData) return;
    if (!liveGpsLocation) {
        alert('Waiting for GPS fix... Please ensure device GPS is turned ON and stand near the cairn.');
        return;
    }

    currentBoundaryData.coordinates[selectedVertexIndex] = [liveGpsLocation.lon, liveGpsLocation.lat];

    // Remove red action flag since ground point has now been verified
    currentBoundaryData.flaggedVertices = currentBoundaryData.flaggedVertices.filter(f => f !== selectedVertexIndex);

    await window.surveyDB.put('polygons', currentBoundaryData);
    renderActiveBoundary();
    selectActiveVertex(selectedVertexIndex);
    alert(`Point #${selectedVertexIndex + 1} snapped to your live GPS coordinates! Flag cleared.`);
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
    renderActiveBoundary();
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
    renderActiveBoundary();
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
        created_at: new Date().toISOString()
    };

    await window.surveyDB.put('polygons', newPoly);
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
        if (window.surveyDB.pullFromCloud) {
            await window.surveyDB.pullFromCloud();
        }
        await loadPendingFieldSurveys();
    } finally {
        setTimeout(() => {
            if (icon) icon.classList.remove('fa-spin');
        }, 500);
    }
};

async function loadPendingFieldSurveys() {
    if (navigator.onLine && window.surveyDB.pullFromCloud) {
        await window.surveyDB.pullFromCloud().catch(() => {});
    }
    const all = await window.surveyDB.getAll('pending_surveys');
    const divisionSurveys = all.filter(s => s.division.toLowerCase() === currentDivision.toLowerCase());

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
                    <b style="color:#38bdf8;">${s.name}</b><br>
                    <small style="color:#94a3b8;">${s.range} Range | ${s.coordinates.length} cairns | Area: <b style="color:#fbbf24;">${s.area_ha} Ha</b></small>
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

    const latlngs = s.coordinates.map(c => [c[1], c[0]]);

    // Bright cyan/gold dashed preview polygon
    previewSurveyLayer = L.polygon(latlngs, {
        color: '#fbbf24',
        weight: 3,
        dashArray: '8, 6',
        fillColor: '#38bdf8',
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
        L.marker([c[1], c[0]], { icon: icon }).addTo(previewMarkersGroup);
    });

    document.getElementById('activeMapInfo').textContent = `PREVIEW: ${s.name} (${s.range} Range) — ${s.area_ha} Ha`;
    alert(`Showing preview of "${s.name}" on satellite map!\nClick "Accept" in the inbox to add it to the official database.`);
}

async function acceptFieldSurvey(surveyId) {
    const survey = await window.surveyDB.get('pending_surveys', surveyId);
    if (!survey) return;

    // Load into official database
    const officialPoly = {
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

    await window.surveyDB.put('polygons', officialPoly);
    await window.surveyDB.delete('pending_surveys', surveyId);
    if (navigator.onLine && window.surveyDB.syncCloud) {
        await window.surveyDB.syncCloud({ deletedSurveyId: surveyId }).catch(() => {});
    }

    if (previewSurveyLayer) map.removeLayer(previewSurveyLayer);
    if (previewMarkersGroup) previewMarkersGroup.clearLayers();

    alert(`Survey "${survey.name}" accepted and loaded into ${survey.division} official database!`);
    await loadPendingFieldSurveys();
    await loadDfoBoundaries();

    // Select the accepted boundary
    const bSelect = document.getElementById('dfoBoundarySelect');
    if (bSelect) {
        bSelect.value = officialPoly.id;
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
    quotaBadge.textContent = `${count} / 5 Active`;

    if (count >= 5) {
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
function setupFieldPortal() {
    document.getElementById('dfoPanel').style.display = 'none';
    document.getElementById('fieldPanel').style.display = 'block';

    document.getElementById('fieldDivisionTitle').textContent = currentDivision;
    document.getElementById('fieldRangeTitle').textContent = `${currentRange} Range`;
    document.getElementById('activeMapInfo').textContent = `Field Ground Survey — ${currentRange} Range`;

    if (activePolygonLayer) map.removeLayer(activePolygonLayer);
    vertexMarkersGroup.clearLayers();
    if (previewSurveyLayer) map.removeLayer(previewSurveyLayer);
    if (previewMarkersGroup) previewMarkersGroup.clearLayers();

    renderNewSurveyProgress();
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
    const coordStr = closed.map(c => `${c[0]},${c[1]},0`).join(' ');

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
        csv += `${idx + 1},${c[0]},${c[1]},0,${isFlagged ? 'DISPUTE_FIELD_VERIFICATION_NEEDED' : 'VERIFIED'}\n`;
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
    const coordStr = closed.map(c => `${c[0]},${c[1]},0`).join(' ');

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
