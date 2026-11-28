// api/sync.js - Universal Master Cloud Sync Engine for ALL 51 TN Forest Divisions
// Ultra-Reliable High-Speed Persistent Cloud Database for Boundaries, Staff, Revisions & Sessions

const JSTASH_READ_URL = 'https://j.jstash.app/Himsc1yr2Ug6G6pQkGUv3w';
const JSTASH_PUT_URL = 'https://api.jstash.app/v1/bins/Himsc1yr2Ug6G6pQkGUv3w';
const JSTASH_TOKEN = 'Bearer js_edit_7uPwJl6a1zEgoxLXTBZzjHvX0-pzP6y6YoTZenDW9hA';
const NTFY_BACKUP_URL = 'https://ntfy.sh/tn_forest_rfrl_survey_topic_991283';

let memoryStore = null;

const DEFAULT_STORE = {
    users: [
        {
            username: 'shashank',
            password: 'shashank@123',
            name: 'Shashank',
            role: 'FIELD_OFFICER',
            division: 'Ranipet',
            range: 'Ranipet Range'
        },
        {
            username: 'fo_abhishek',
            password: 'fo_abhishek@123',
            name: 'FO_ABHISHEK',
            role: 'FIELD_OFFICER',
            division: 'Pudukkottai',
            range: 'Pudukkottai Range'
        }
    ],
    polygons: [],
    pending_surveys: [],
    deleted_survey_ids: [],
    deleted_polygon_ids: [],
    deleted_user_ids: [],
    active_sessions: {},
    last_synced: new Date().toISOString()
};

async function fetchMasterStore() {
    try {
        const res = await fetch(JSTASH_READ_URL, { cache: 'no-store' });
        if (res.ok) {
            const d = await res.json();
            if (d && typeof d === 'object') {
                const store = {
                    users: Array.isArray(d.users) ? d.users : (memoryStore ? memoryStore.users : DEFAULT_STORE.users),
                    polygons: Array.isArray(d.polygons) ? d.polygons : (memoryStore ? memoryStore.polygons : []),
                    pending_surveys: Array.isArray(d.pending_surveys) ? d.pending_surveys : (memoryStore ? memoryStore.pending_surveys : []),
                    deleted_survey_ids: Array.isArray(d.deleted_survey_ids) ? d.deleted_survey_ids : [],
                    deleted_polygon_ids: Array.isArray(d.deleted_polygon_ids) ? d.deleted_polygon_ids : [],
                    deleted_user_ids: Array.isArray(d.deleted_user_ids) ? d.deleted_user_ids : [],
                    active_sessions: (typeof d.active_sessions === 'object' && d.active_sessions !== null) ? d.active_sessions : {},
                    last_synced: d.last_synced || new Date().toISOString()
                };
                memoryStore = store;
                return store;
            }
        }
    } catch (e) {
        console.error('Error fetching master store:', e.message);
    }

    if (memoryStore) return memoryStore;
    return JSON.parse(JSON.stringify(DEFAULT_STORE));
}

async function putMasterStore(data) {
    try {
        data.last_synced = new Date().toISOString();
        memoryStore = data;

        const payloadStr = JSON.stringify(data);

        // Primary: Update jstash master bin
        const res = await fetch(JSTASH_PUT_URL, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': JSTASH_TOKEN
            },
            body: payloadStr
        });

        // Background secondary backup to ntfy.sh (fire and forget)
        fetch(NTFY_BACKUP_URL, {
            method: 'POST',
            body: payloadStr
        }).catch(() => {});

        return res.ok;
    } catch (e) {
        console.error('Error saving master store:', e.message);
        return false;
    }
}

module.exports = async function handler(req, res) {
    // Universal CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
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
            const SESSION_TIMEOUT_MS = 60000; // 60 seconds heartbeat timeout

            // -------------------------------------------------------------
            // ACTION 1: ACQUIRE EXCLUSIVE SESSION (Single Login Enforcement)
            // -------------------------------------------------------------
            if (action === 'acquire_session') {
                const { sessionKey, deviceId, deviceType, force } = body;
                if (!sessionKey || !deviceId) {
                    return res.status(400).json({ success: false, error: 'Missing sessionKey or deviceId' });
                }

                const currentSession = store.active_sessions[sessionKey];

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
            // ACTION 2: HEARTBEAT
            // -------------------------------------------------------------
            if (action === 'heartbeat') {
                const { sessionKey, deviceId, deviceType } = body;
                if (!sessionKey || !deviceId) {
                    return res.status(200).json({ success: true });
                }

                const currentSession = store.active_sessions[sessionKey];

                if (!currentSession || currentSession.deviceId === deviceId) {
                    store.active_sessions[sessionKey] = {
                        deviceId: deviceId,
                        deviceType: deviceType || (currentSession ? currentSession.deviceType : 'Device'),
                        lastHeartbeat: now,
                        loginTime: currentSession ? currentSession.loginTime : now
                    };
                    await putMasterStore(store);
                    return res.status(200).json({ success: true });
                } else if (now - (currentSession.lastHeartbeat || 0) < SESSION_TIMEOUT_MS) {
                    return res.status(200).json({
                        success: false,
                        code: 'SESSION_TERMINATED',
                        deviceType: currentSession.deviceType || 'Another Device',
                        message: `Logged out: Session was opened on ${currentSession.deviceType || 'another device'}.`
                    });
                } else {
                    store.active_sessions[sessionKey] = {
                        deviceId: deviceId,
                        deviceType: deviceType || 'Device',
                        lastHeartbeat: now,
                        loginTime: now
                    };
                    await putMasterStore(store);
                    return res.status(200).json({ success: true });
                }
            }

            // -------------------------------------------------------------
            // ACTION 3: RELEASE SESSION (Instant Logout)
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
            // ACTION 4: FULL BI-DIRECTIONAL DATA MERGE FOR ALL 51 DIVISIONS
            // -------------------------------------------------------------
            // 1. Merge deleted survey IDs
            if (body.deleted_survey_ids && Array.isArray(body.deleted_survey_ids)) {
                const delSet = new Set(store.deleted_survey_ids || []);
                body.deleted_survey_ids.forEach(id => delSet.add(id));
                store.deleted_survey_ids = Array.from(delSet);
            }

            // 2. Merge deleted polygon IDs
            if (body.deleted_polygon_ids && Array.isArray(body.deleted_polygon_ids)) {
                const delPolySet = new Set(store.deleted_polygon_ids || []);
                body.deleted_polygon_ids.forEach(id => delPolySet.add(id));
                store.deleted_polygon_ids = Array.from(delPolySet);
            }

            // 2b. Merge deleted user IDs
            if (body.deleted_user_ids && Array.isArray(body.deleted_user_ids)) {
                const delUserSet = new Set(store.deleted_user_ids || []);
                body.deleted_user_ids.forEach(u => delUserSet.add(u.toLowerCase()));
                store.deleted_user_ids = Array.from(delUserSet);
            }

            // 3. Merge pending surveys (filtering out deleted ones)
            const delSurvSet = new Set(store.deleted_survey_ids || []);
            const survMap = new Map();
            (store.pending_surveys || []).forEach(s => {
                if (s && s.id && !delSurvSet.has(s.id)) survMap.set(s.id, s);
            });
            if (body.pending_surveys && Array.isArray(body.pending_surveys)) {
                body.pending_surveys.forEach(s => {
                    if (s && s.id && !delSurvSet.has(s.id)) {
                        survMap.set(s.id, s);
                    }
                });
            }
            store.pending_surveys = Array.from(survMap.values());

            // 4. Merge polygons: strictly prevent duplicate RFs by division + name (overwrite existing)
            const delPolySet = new Set(store.deleted_polygon_ids || []);
            const polyByNameMap = new Map();

            const makePolyKey = (p) => `${(p.division || '').toLowerCase().trim()}:::${(p.name || '').toLowerCase().trim()}`;

            (store.polygons || []).forEach(p => {
                if (p && p.id && !delPolySet.has(p.id)) {
                    const key = makePolyKey(p);
                    const existing = polyByNameMap.get(key);
                    if (!existing) {
                        polyByNameMap.set(key, p);
                    } else {
                        const existTime = existing.updated_at ? new Date(existing.updated_at).getTime() : (existing.created_at ? new Date(existing.created_at).getTime() : 0);
                        const pTime = p.updated_at ? new Date(p.updated_at).getTime() : (p.created_at ? new Date(p.created_at).getTime() : 0);
                        if (pTime >= existTime) {
                            p.id = existing.id;
                            polyByNameMap.set(key, p);
                        }
                    }
                }
            });

            if (body.polygons && Array.isArray(body.polygons)) {
                body.polygons.forEach(p => {
                    if (p && p.id && !delPolySet.has(p.id)) {
                        const key = makePolyKey(p);
                        const existing = polyByNameMap.get(key);
                        if (!existing) {
                            polyByNameMap.set(key, p);
                        } else {
                            const existTime = existing.updated_at ? new Date(existing.updated_at).getTime() : (existing.created_at ? new Date(existing.created_at).getTime() : 0);
                            const inTime = p.updated_at ? new Date(p.updated_at).getTime() : (p.created_at ? new Date(p.created_at).getTime() : 0);
                            if (inTime >= existTime) {
                                p.id = existing.id; // Keep canonical ID, overwrite data
                                polyByNameMap.set(key, p);
                            }
                        }
                    }
                });
            }
            store.polygons = Array.from(polyByNameMap.values());

            // 5. Merge users for ALL divisions & ranges uniquely by username
            const delUserSet = new Set(store.deleted_user_ids || []);
            const userMap = new Map();
            (store.users || []).forEach(u => {
                if (u && u.username && !delUserSet.has(u.username.toLowerCase())) {
                    userMap.set(u.username.toLowerCase(), u);
                }
            });
            if (body.users && Array.isArray(body.users)) {
                body.users.forEach(u => {
                    if (u && u.username && !delUserSet.has(u.username.toLowerCase())) {
                        userMap.set(u.username.toLowerCase(), u);
                    }
                });
            }
            store.users = Array.from(userMap.values());

            await putMasterStore(store);

            return res.status(200).json({
                success: true,
                message: 'Universal cloud sync completed successfully',
                data: store
            });
        } catch (err) {
            console.error('Sync POST error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    }
};
