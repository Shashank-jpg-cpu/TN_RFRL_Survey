// api/sync.js - Persistent Master Cloud Sync & Single-Session Enforcement
// Powered by persistent cloud storage for Desktop, Mobile Web, and Android App

const CLOUD_STORAGE_URL = 'https://api.restful-api.dev/objects/ff808181a09d98f701a21c1ecc086157';

const DEFAULT_STORE = {
    users: [
        {
            username: 'shashank',
            password: 'shashank@123',
            name: 'Shashank (Field Officer)',
            role: 'FIELD_OFFICER',
            division: 'Ranipet',
            range: 'Ranipet Range',
            created_at: new Date().toISOString(),
            created_by: 'DFO (Ranipet)'
        }
    ],
    polygons: [],
    pending_surveys: [],
    deleted_survey_ids: [],
    active_sessions: {},
    last_synced: new Date().toISOString()
};

async function fetchMasterStore() {
    try {
        const res = await fetch(CLOUD_STORAGE_URL, { cache: 'no-store' });
        if (res.ok) {
            const json = await res.json();
            if (json && json.data) {
                const d = json.data;
                return {
                    users: Array.isArray(d.users) ? d.users : DEFAULT_STORE.users,
                    polygons: Array.isArray(d.polygons) ? d.polygons : [],
                    pending_surveys: Array.isArray(d.pending_surveys) ? d.pending_surveys : [],
                    deleted_survey_ids: Array.isArray(d.deleted_survey_ids) ? d.deleted_survey_ids : [],
                    active_sessions: (typeof d.active_sessions === 'object' && d.active_sessions !== null) ? d.active_sessions : {},
                    last_synced: d.last_synced || new Date().toISOString()
                };
            }
        }
    } catch (e) {
        console.error('Error reading from cloud store:', e.message);
    }
    return JSON.parse(JSON.stringify(DEFAULT_STORE));
}

async function putMasterStore(data) {
    try {
        data.last_synced = new Date().toISOString();
        const res = await fetch(CLOUD_STORAGE_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'TN_Forest_RFRL_Survey_Master',
                data: data
            })
        });
        return res.ok;
    } catch (e) {
        console.error('Error writing to cloud store:', e.message);
        return false;
    }
}

export default async function handler(req, res) {
    // Universal CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method === 'GET') {
        const store = await fetchMasterStore();
        return res.status(200).json({
            success: true,
            data: store,
            timestamp: new Date().toISOString()
        });
    }

    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
            const action = body.action || 'sync_data';
            const store = await fetchMasterStore();
            const now = Date.now();

            // -------------------------------------------------------------
            // ACTION 1: ACQUIRE EXCLUSIVE SESSION (Single Login Enforcement)
            // -------------------------------------------------------------
            if (action === 'acquire_session') {
                const { sessionKey, deviceId, deviceType, force } = body;
                if (!sessionKey || !deviceId) {
                    return res.status(400).json({ success: false, error: 'Missing sessionKey or deviceId' });
                }

                const currentSession = store.active_sessions[sessionKey];
                const SESSION_TIMEOUT_MS = 45000; // 45 seconds timeout if tab abruptly closed

                if (currentSession && currentSession.deviceId !== deviceId && (now - (currentSession.lastHeartbeat || 0) < SESSION_TIMEOUT_MS) && !force) {
                    return res.status(200).json({
                        success: false,
                        code: 'ALREADY_LOGGED_IN',
                        deviceType: currentSession.deviceType || 'Another Device',
                        lastActive: currentSession.lastHeartbeat,
                        message: `Access Blocked: This portal is currently active on ${currentSession.deviceType || 'another device'}. Only 1 active login is allowed at a time.`
                    });
                }

                // Grant session to this device
                store.active_sessions[sessionKey] = {
                    deviceId: deviceId,
                    deviceType: deviceType || 'Unknown Device',
                    lastHeartbeat: now,
                    loginTime: now
                };

                await putMasterStore(store);

                return res.status(200).json({
                    success: true,
                    message: 'Exclusive portal session granted',
                    session: store.active_sessions[sessionKey]
                });
            }

            // -------------------------------------------------------------
            // ACTION 2: HEARTBEAT (Keep Session Alive & Detect Remote Takeover)
            // -------------------------------------------------------------
            if (action === 'heartbeat') {
                const { sessionKey, deviceId } = body;
                if (!sessionKey || !deviceId) {
                    return res.status(200).json({ success: true });
                }

                const currentSession = store.active_sessions[sessionKey];
                if (!currentSession || currentSession.deviceId === deviceId) {
                    if (!store.active_sessions[sessionKey]) {
                        store.active_sessions[sessionKey] = { deviceId, deviceType: body.deviceType || 'Device', lastHeartbeat: now };
                    } else {
                        store.active_sessions[sessionKey].lastHeartbeat = now;
                    }
                    await putMasterStore(store);
                    return res.status(200).json({ success: true });
                } else {
                    // Session was taken over by another device!
                    return res.status(200).json({
                        success: false,
                        code: 'SESSION_TERMINATED',
                        message: `Logged out: Session was opened on ${currentSession.deviceType || 'another device'}.`
                    });
                }
            }

            // -------------------------------------------------------------
            // ACTION 3: RELEASE SESSION (Instant Logout Unlocking)
            // -------------------------------------------------------------
            if (action === 'release_session') {
                const { sessionKey, deviceId } = body;
                if (sessionKey && store.active_sessions[sessionKey]) {
                    if (!deviceId || store.active_sessions[sessionKey].deviceId === deviceId) {
                        delete store.active_sessions[sessionKey];
                        await putMasterStore(store);
                    }
                }
                return res.status(200).json({ success: true, message: 'Session released successfully' });
            }

            // -------------------------------------------------------------
            // ACTION 4: SYNC DATA (Surveys, Polygons, Staff Accounts)
            // -------------------------------------------------------------
            // Merge deleted survey IDs
            if (body.deleted_survey_ids && Array.isArray(body.deleted_survey_ids)) {
                const delSet = new Set(store.deleted_survey_ids || []);
                body.deleted_survey_ids.forEach(id => delSet.add(id));
                store.deleted_survey_ids = Array.from(delSet);
            }

            // Merge pending surveys (filtering out deleted ones)
            const delSet = new Set(store.deleted_survey_ids || []);
            const survMap = new Map();
            (store.pending_surveys || []).forEach(s => {
                if (s && s.id && !delSet.has(s.id)) survMap.set(s.id, s);
            });
            if (body.pending_surveys && Array.isArray(body.pending_surveys)) {
                body.pending_surveys.forEach(s => {
                    if (s && s.id && !delSet.has(s.id)) {
                        survMap.set(s.id, s);
                    }
                });
            }
            store.pending_surveys = Array.from(survMap.values());

            // Merge users uniquely by username
            const userMap = new Map();
            (store.users || []).forEach(u => userMap.set(u.username.toLowerCase(), u));
            if (body.users && Array.isArray(body.users)) {
                body.users.forEach(u => {
                    if (u && u.username) {
                        userMap.set(u.username.toLowerCase(), u);
                    }
                });
            }
            store.users = Array.from(userMap.values());

            // Merge polygons uniquely by ID
            const polyMap = new Map();
            (store.polygons || []).forEach(p => polyMap.set(p.id, p));
            if (body.polygons && Array.isArray(body.polygons)) {
                body.polygons.forEach(p => {
                    if (p && p.id) {
                        polyMap.set(p.id, p);
                    }
                });
            }
            store.polygons = Array.from(polyMap.values());

            await putMasterStore(store);

            return res.status(200).json({
                success: true,
                message: 'Cloud sync completed successfully',
                data: store
            });
        } catch (err) {
            console.error('Sync POST error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
