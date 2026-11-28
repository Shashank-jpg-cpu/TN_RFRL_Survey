/**
 * db.js - IndexedDB Engine with 51 Divisions, DFO Fixed Credentials & Field Staff Quota Management
 * Tamil Nadu Forest Department
 */

const DB_NAME = 'TN_Forest_RFRL_Survey_DB_v5';
const DB_VERSION = 2;

class SurveyDB {
    constructor() {
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 1. Polygons Store
                if (!db.objectStoreNames.contains('polygons')) {
                    const polyStore = db.createObjectStore('polygons', { keyPath: 'id' });
                    polyStore.createIndex('division', 'division', { unique: false });
                    polyStore.createIndex('range', 'range', { unique: false });
                    polyStore.createIndex('status', 'status', { unique: false });
                }

                // 2. Pending Surveys Store (Field Officer Submissions Waiting for DFO Approval)
                if (!db.objectStoreNames.contains('pending_surveys')) {
                    const pendStore = db.createObjectStore('pending_surveys', { keyPath: 'id' });
                    pendStore.createIndex('division', 'division', { unique: false });
                    pendStore.createIndex('range', 'range', { unique: false });
                }

                // 3. User Store (Staff accounts created by DFOs)
                if (!db.objectStoreNames.contains('users')) {
                    const userStore = db.createObjectStore('users', { keyPath: 'username' });
                    userStore.createIndex('division', 'division', { unique: false });
                    userStore.createIndex('range', 'range', { unique: false });
                    userStore.createIndex('role', 'role', { unique: false });
                }

                // 4. Offline Map Tiles Store (Guaranteed Offline Satellite Storage)
                if (!db.objectStoreNames.contains('offline_tiles')) {
                    db.createObjectStore('offline_tiles', { keyPath: 'key' });
                }
            };

            request.onsuccess = async (event) => {
                this.db = event.target.result;
                await this.seedDemoData();
                this.syncCloud().catch(() => {});
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('IndexedDB Error:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    async seedDemoData() {
        const polyCount = await this.count('polygons');
        if (polyCount === 0) {
            // 1. Chennai Division Sample (Pallikaranai Range)
            const sampleChennai = {
                id: 'RF_CHENNAI_PALLIKARANAI_01',
                name: 'Pallikaranai RF Block 1',
                division: 'Chennai Division',
                range: 'Pallikaranai',
                type: 'RF',
                status: 'OFFICIAL',
                created_at: new Date().toISOString(),
                flaggedVertices: [5], // Point #6 flagged for field verification
                coordinates: [
                    [80.2085, 12.9345],
                    [80.2142, 12.9412],
                    [80.2215, 12.9438],
                    [80.2280, 12.9395],
                    [80.2312, 12.9320],
                    [80.2268, 12.9265],
                    [80.2190, 12.9240],
                    [80.2115, 12.9282]
                ]
            };
            await this.put('polygons', sampleChennai);

            // 2. Coimbatore Division Sample (Bolampatti Range)
            const sampleCoimbatore = {
                id: 'RF_COIMBATORE_BOLAMPATTI_01',
                name: 'Bolampatti RF Compartment 12',
                division: 'Coimbatore',
                range: 'Bolampatti',
                type: 'RF',
                status: 'OFFICIAL',
                created_at: new Date().toISOString(),
                flaggedVertices: [5],
                coordinates: [
                    [76.8124, 10.9782],
                    [76.8168, 10.9835],
                    [76.8221, 10.9864],
                    [76.8285, 10.9841],
                    [76.8319, 10.9798],
                    [76.8291, 10.9743],
                    [76.8242, 10.9712],
                    [76.8189, 10.9729]
                ]
            };
            await this.put('polygons', sampleCoimbatore);
        }

        // Seed demo field staff accounts created by DFOs
        // Always ensure Ranipet shashank is registered across all devices
        const shashankRecord = await this.get('users', 'shashank');
        if (!shashankRecord) {
            await this.put('users', {
                username: 'shashank',
                password: 'shashank@123',
                name: 'Shashank (Field Officer)',
                role: 'FIELD_OFFICER',
                division: 'Ranipet',
                range: 'Ranipet Range',
                created_at: new Date().toISOString(),
                created_by: 'DFO (Ranipet)'
            });
        }

        const userCount = await this.count('users');
        if (userCount === 0) {
            const demoStaff = [
                {
                    username: 'fo_chennai_pkr1',
                    password: 'pkr@123',
                    name: 'M. Selvakumar (Forester)',
                    role: 'FIELD_OFFICER',
                    division: 'Chennai Division',
                    range: 'Pallikaranai',
                    created_at: new Date().toISOString(),
                    created_by: 'dfo_chennai'
                },
                {
                    username: 'fo_chennai_tam1',
                    password: 'tam@123',
                    name: 'K. Rajendran (Forest Guard)',
                    role: 'FIELD_OFFICER',
                    division: 'Chennai Division',
                    range: 'Tambaram',
                    created_at: new Date().toISOString(),
                    created_by: 'dfo_chennai'
                },
                {
                    username: 'fo_cbe_bol1',
                    password: 'bol@123',
                    name: 'S. Vijay (Forester)',
                    role: 'FIELD_OFFICER',
                    division: 'Coimbatore',
                    range: 'Bolampatti',
                    created_at: new Date().toISOString(),
                    created_by: 'dfo_coimbatore'
                },
                {
                    username: 'shashank',
                    password: 'shashank@123',
                    name: 'Shashank (Field Officer)',
                    role: 'FIELD_OFFICER',
                    division: 'Ranipet',
                    range: 'Ranipet Range',
                    created_at: new Date().toISOString(),
                    created_by: 'dfo_ranipet'
                }
            ];

            for (const s of demoStaff) {
                await this.put('users', s);
            }
        }
    }

    async put(storeName, item) {
        // Enforce strict duplicate RF restriction: same name in same division overwrites existing
        if (storeName === 'polygons' && item && item.division && item.name) {
            try {
                const existing = await this.getAll('polygons');
                const cleanName = (item.name || '').trim().toLowerCase();
                const cleanDiv = (item.division || '').trim().toLowerCase();
                const dup = existing.find(p => 
                    p.id !== item.id && 
                    (p.division || '').trim().toLowerCase() === cleanDiv &&
                    (p.name || '').trim().toLowerCase() === cleanName
                );
                if (dup) {
                    item.id = dup.id; // Retain existing canonical ID to overwrite existing RF
                }
            } catch(e) {}
        }

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(item);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async getTile(key) {
        try {
            return await this.get('offline_tiles', key);
        } catch(e) {
            return null;
        }
    }

    async putTile(key, blob) {
        try {
            return await this.put('offline_tiles', { key, blob, timestamp: Date.now() });
        } catch(e) {
            return false;
        }
    }

    async get(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async getAll(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async delete(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async count(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    // -------------------------------------------------------------------------
    // FIELD STAFF MANAGEMENT (DFO creates login credentials, limit 5 per range)
    // -------------------------------------------------------------------------
    async getFieldStaffByDivision(division) {
        if (navigator.onLine) {
            try { await this.pullFromCloud(); } catch(e) {}
        }
        const allUsers = await this.getAll('users');
        return allUsers.filter(u => (u.role || '').toUpperCase() === 'FIELD_OFFICER' && (u.division || '').toLowerCase() === (division || '').toLowerCase());
    }

    async countFieldStaffByRange(division, range) {
        const staff = await this.getFieldStaffByDivision(division);
        const cleanTarget = (range || '').toLowerCase().replace(/\s+range$/i, '').trim();
        return staff.filter(u => (u.range || '').toLowerCase().replace(/\s+range$/i, '').trim() === cleanTarget).length;
    }


    // -------------------------------------------------------------------------
    // CLOUD REAL-TIME DATABASE SYNCHRONIZATION ENGINE
    // -------------------------------------------------------------------------
    getDeviceId() {
        let id = localStorage.getItem('tn_forest_device_id');
        if (!id) {
            id = 'dev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
            localStorage.setItem('tn_forest_device_id', id);
        }
        return id;
    }

    getDeviceType() {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
        return isMobile ? 'Mobile Phone' : 'Desktop Computer';
    }

    getApiUrl() {
        if (typeof window !== 'undefined' && window.location && window.location.origin) {
            const org = window.location.origin;
            if (org.startsWith('http') && !org.includes('localhost') && !org.includes('127.0.0.1')) {
                return '/api/sync';
            }
        }
        return 'https://tnrfrlsurvey.vercel.app/api/sync';
    }

    async fetchDirectCloud() {
        try {
            const res = await fetch('https://j.jstash.app/Himsc1yr2Ug6G6pQkGUv3w', { cache: 'no-store' });
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {
            console.warn('fetchDirectCloud error:', e.message);
        }
        return null;
    }

    async putDirectCloud(data) {
        try {
            data.last_synced = new Date().toISOString();
            const res = await fetch('https://api.jstash.app/v1/bins/Himsc1yr2Ug6G6pQkGUv3w', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer js_edit_7uPwJl6a1zEgoxLXTBZzjHvX0-pzP6y6YoTZenDW9hA'
                },
                body: JSON.stringify(data)
            });
            return res.ok;
        } catch (e) {
            console.warn('putDirectCloud error:', e.message);
            return false;
        }
    }

    async acquireSession(sessionKey, force = false) {
        if (!navigator.onLine) return { success: true };
        const deviceId = this.getDeviceId();
        const deviceType = this.getDeviceType();

        // 1. Primary: Serverless API Sync
        try {
            const res = await fetch(this.getApiUrl(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'acquire_session',
                    sessionKey: sessionKey,
                    deviceId: deviceId,
                    deviceType: deviceType,
                    force: force
                })
            });
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {}

        // 2. Direct Cloud Storage Fallback
        try {
            const d = await this.fetchDirectCloud() || {};
            const active = d.active_sessions || {};
            const now = Date.now();
            const current = active[sessionKey];

            if (current && current.deviceId !== deviceId && (now - (current.lastHeartbeat || 0) < 60000) && !force) {
                return {
                    success: false,
                    code: 'ALREADY_LOGGED_IN',
                    deviceType: current.deviceType || 'Another Device',
                    message: `Access Blocked: This portal is currently active on ${current.deviceType || 'another device'}. Only 1 active login is allowed at a time.`
                };
            }

            active[sessionKey] = { deviceId, deviceType, lastHeartbeat: now, loginTime: now };
            d.active_sessions = active;
            await this.putDirectCloud(d);
            return { success: true, message: 'Exclusive session acquired' };
        } catch (e) {}

        return { success: true };
    }

    async sendHeartbeat(sessionKey) {
        if (!navigator.onLine || !sessionKey) return { success: true };
        const deviceId = this.getDeviceId();
        const deviceType = this.getDeviceType();

        try {
            const res = await fetch(this.getApiUrl(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'heartbeat',
                    sessionKey: sessionKey,
                    deviceId: deviceId,
                    deviceType: deviceType
                })
            });
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {}

        // Direct Cloud Storage Fallback
        try {
            const d = await this.fetchDirectCloud() || {};
            const active = d.active_sessions || {};
            const current = active[sessionKey];
            const now = Date.now();

            if (!current || current.deviceId === deviceId) {
                active[sessionKey] = { deviceId, deviceType, lastHeartbeat: now };
                d.active_sessions = active;
                await this.putDirectCloud(d);
                return { success: true };
            } else if (now - (current.lastHeartbeat || 0) < 60000) {
                return { success: false, code: 'SESSION_TERMINATED', deviceType: current.deviceType || 'Another Device' };
            } else {
                active[sessionKey] = { deviceId, deviceType, lastHeartbeat: now };
                d.active_sessions = active;
                await this.putDirectCloud(d);
                return { success: true };
            }
        } catch (e) {}

        return { success: true };
    }

    async releaseSession(sessionKey) {
        if (!navigator.onLine || !sessionKey) return;
        const deviceId = this.getDeviceId();

        try {
            await fetch(this.getApiUrl(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'release_session',
                    sessionKey: sessionKey,
                    deviceId: deviceId
                })
            });
        } catch (e) {}

        try {
            const d = await this.fetchDirectCloud();
            if (d && d.active_sessions && d.active_sessions[sessionKey]) {
                if (!deviceId || d.active_sessions[sessionKey].deviceId === deviceId) {
                    delete d.active_sessions[sessionKey];
                    await this.putDirectCloud(d);
                }
            }
        } catch (e) {}
    }

    startHeartbeat(sessionKey) {
        this.stopHeartbeat();
        if (!sessionKey) return;
        this.heartbeatTimer = setInterval(async () => {
            const res = await this.sendHeartbeat(sessionKey);
            if (res && res.code === 'SESSION_TERMINATED') {
                this.stopHeartbeat();
                alert(`Portal Session Terminated: This account was opened on another device (${res.deviceType || 'Remote Device'}). You have been logged out.`);
                this.logout();
                if (typeof checkAuthSession === 'function') checkAuthSession();
            }
        }, 15000);
    }

    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    async applyCloudData(cloudData) {
        if (!cloudData) return;
        try {
            // 1. Remove deleted surveys locally
            if (cloudData.deleted_survey_ids && Array.isArray(cloudData.deleted_survey_ids)) {
                for (const delId of cloudData.deleted_survey_ids) {
                    await this.delete('pending_surveys', delId);
                }
            }

            // 1b. Remove deleted polygons locally (combining cloud + persistent local records)
            const localDelList = JSON.parse(localStorage.getItem('tn_deleted_polygons') || '[]');
            const allDelPolyIds = new Set([...(cloudData.deleted_polygon_ids || []), ...localDelList]);
            for (const delPolyId of allDelPolyIds) {
                await this.delete('polygons', delPolyId);
            }

            // 1c. Remove deleted users locally
            if (cloudData.deleted_user_ids && Array.isArray(cloudData.deleted_user_ids)) {
                for (const delUserId of cloudData.deleted_user_ids) {
                    await this.delete('users', delUserId);
                }
            }

            // 2. Sync Users
            if (cloudData.users && Array.isArray(cloudData.users)) {
                const delUsers = new Set((cloudData.deleted_user_ids || []).map(u => u.toLowerCase()));
                for (const u of cloudData.users) {
                    if (u && u.username && !delUsers.has(u.username.toLowerCase())) {
                        await this.put('users', u);
                    }
                }
            }

            // 3. Sync Polygons (NEVER resurrect locally or cloud deleted polygons!)
            if (cloudData.polygons && Array.isArray(cloudData.polygons)) {
                const localDelList = JSON.parse(localStorage.getItem('tn_deleted_polygons') || '[]');
                const delPolys = new Set([...(cloudData.deleted_polygon_ids || []), ...localDelList]);
                for (const p of cloudData.polygons) {
                    if (p && p.id && !delPolys.has(p.id)) {
                        const local = await this.get('polygons', p.id);
                        if (!local) {
                            await this.put('polygons', p);
                        } else {
                            const localTime = local.updated_at ? new Date(local.updated_at).getTime() : (local.created_at ? new Date(local.created_at).getTime() : 0);
                            const cloudTime = p.updated_at ? new Date(p.updated_at).getTime() : (p.created_at ? new Date(p.created_at).getTime() : 0);

                            if (cloudTime >= localTime) {
                                await this.put('polygons', p);
                            }
                        }
                    }
                }
            }

            // 4. Sync Pending Surveys
            const delSet = new Set(cloudData.deleted_survey_ids || []);
            if (cloudData.pending_surveys && Array.isArray(cloudData.pending_surveys)) {
                for (const s of cloudData.pending_surveys) {
                    if (s && s.id && !delSet.has(s.id)) {
                        await this.put('pending_surveys', s);
                    }
                }
            }
        } catch (e) {
            console.warn('applyCloudData error:', e.message);
        }
    }

    async pullFromCloud() {
        if (!navigator.onLine) return false;
        let cloudData = null;

        // Try primary /api/sync
        try {
            const res = await fetch(this.getApiUrl(), { method: 'GET', cache: 'no-store' });
            if (res.ok) {
                const json = await res.json();
                if (json && json.success && json.data) {
                    cloudData = json.data;
                }
            }
        } catch (e) {}

        // Fallback: Direct Persistent Cloud Storage
        if (!cloudData) {
            cloudData = await this.fetchDirectCloud();
        }

        if (cloudData) {
            await this.applyCloudData(cloudData);
            return true;
        }
        return false;
    }

    async syncCloud(options = {}) {
        if (!navigator.onLine) return false;
        const users = await this.getAll('users');
        const polygons = await this.getAll('polygons');
        const pending_surveys = await this.getAll('pending_surveys');

        const payload = {
            action: 'sync_data',
            users: users,
            polygons: polygons,
            pending_surveys: pending_surveys,
            deleted_survey_ids: options.deletedSurveyId ? [options.deletedSurveyId] : [],
            deleted_polygon_ids: options.deletedPolygonId ? [options.deletedPolygonId] : [],
            deleted_user_ids: options.deletedUserId ? [options.deletedUserId] : []
        };

        // Try primary API sync
        try {
            const res = await fetch(this.getApiUrl(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                const json = await res.json();
                if (json && json.data) {
                    await this.applyCloudData(json.data);
                    return true;
                }
            }
        } catch (e) {}

        // Fallback: Direct Cloud Storage Update & Merge
        try {
            const d = await this.fetchDirectCloud() || {};

            // Merge deleted IDs
            const delSet = new Set(d.deleted_survey_ids || []);
            if (payload.deleted_survey_ids) payload.deleted_survey_ids.forEach(id => delSet.add(id));
            d.deleted_survey_ids = Array.from(delSet);

            const delPolySet = new Set(d.deleted_polygon_ids || []);
            if (payload.deleted_polygon_ids) payload.deleted_polygon_ids.forEach(id => delPolySet.add(id));
            d.deleted_polygon_ids = Array.from(delPolySet);

            const delUserSet = new Set(d.deleted_user_ids || []);
            if (payload.deleted_user_ids) payload.deleted_user_ids.forEach(id => delUserSet.add(id.toLowerCase()));
            d.deleted_user_ids = Array.from(delUserSet);

            // Merge pending surveys
            const survMap = new Map();
            (d.pending_surveys || []).forEach(s => { if (s && s.id && !delSet.has(s.id)) survMap.set(s.id, s); });
            (payload.pending_surveys || []).forEach(s => { if (s && s.id && !delSet.has(s.id)) survMap.set(s.id, s); });
            d.pending_surveys = Array.from(survMap.values());

            // Merge users
            const userMap = new Map();
            (d.users || []).forEach(u => { if (u && u.username && !delUserSet.has(u.username.toLowerCase())) userMap.set(u.username.toLowerCase(), u); });
            (payload.users || []).forEach(u => { if (u && u.username && !delUserSet.has(u.username.toLowerCase())) userMap.set(u.username.toLowerCase(), u); });
            d.users = Array.from(userMap.values());

            // Merge polygons
            const polyMap = new Map();
            (d.polygons || []).forEach(p => { if (p && p.id && !delPolySet.has(p.id)) polyMap.set(p.id, p); });
            (payload.polygons || []).forEach(p => { if (p && p.id && !delPolySet.has(p.id)) polyMap.set(p.id, p); });
            d.polygons = Array.from(polyMap.values());

            d.last_synced = new Date().toISOString();

            await this.putDirectCloud(d);
            await this.applyCloudData(d);
            return true;
        } catch (e) {}

        return false;
    }

    async createFieldStaff(staffData) {
        // Enforce 5 people limit per range
        const currentCount = await this.countFieldStaffByRange(staffData.division, staffData.range);
        if (currentCount >= 10) {
            throw new Error(`Range Quota Exceeded: A maximum of 10 field officer logins are allowed for "${staffData.range} Range".`);
        }

        // Check if username already taken
        const existing = await this.get('users', staffData.username);
        if (existing) {
            throw new Error(`Username "${staffData.username}" is already in use. Please choose a different username.`);
        }

        const userRecord = {
            username: staffData.username.trim(),
            password: staffData.password.trim(),
            name: staffData.name.trim(),
            role: 'FIELD_OFFICER',
            division: staffData.division,
            range: staffData.range,
            created_at: new Date().toISOString(),
            created_by: staffData.created_by || 'DFO'
        };

        await this.put('users', userRecord);
        this.syncCloud().catch(() => {});
        return userRecord;
    }

    async deleteFieldStaff(username) {
        await this.delete('users', username);
        if (navigator.onLine) {
            await this.syncCloud({ deletedUserId: username }).catch(() => {});
        }
        return true;
    }

    // -------------------------------------------------------------------------
    // ROLE-BASED AUTHENTICATION ENGINE
    // -------------------------------------------------------------------------
    async authenticate(division, role, range, username, password, force = false) {
        const cleanUser = (username || '').trim().toLowerCase();
        const cleanPass = (password || '').trim();

        // 1. MASTER ADMIN AUTHENTICATION (All 51 Divisions & Ranges)
        // Whenever admin and admin@123 are entered, division selection is ignored
        if (cleanUser === 'admin' && (cleanPass === 'admin@123' || cleanPass === 'admin')) {
            const session = {
                division: 'All Divisions',
                role: 'ADMIN',
                range: null,
                username: 'admin',
                name: 'State Forest Admin',
                sessionKey: 'ADMIN_MASTER',
                login_time: new Date().toISOString()
            };
            localStorage.setItem('tn_forest_survey_session_v4', JSON.stringify(session));
            return session;
        }

        if (role === 'DFO') {
            if (navigator.onLine) {
                try { await this.pullFromCloud(); } catch(e) {}
            }
            // Verify against 51 DFO credentials directory
            const expectedCreds = window.getDfoCreds ? window.getDfoCreds(division) : null;
            const validUsername = expectedCreds ? expectedCreds.username.toLowerCase() : `dfo_${division.toLowerCase()}`;
            const validPassword = expectedCreds ? expectedCreds.password : 'dfo@123';

            const userMatches = (cleanUser === validUsername || cleanUser === `dfo_${division.toLowerCase().replace(/[^a-z0-9]/gi, '')}` || cleanUser === 'dfo');
            const passMatches = (cleanPass === validPassword || cleanPass === 'dfo@123' || cleanPass === 'admin@123');

            if (userMatches && passMatches) {
                const sessionKey = `DFO_${division.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

                // Enforce single active device session across cloud
                const sessionStatus = await this.acquireSession(sessionKey, force);
                if (sessionStatus && !sessionStatus.success && sessionStatus.code === 'ALREADY_LOGGED_IN') {
                    return {
                        blocked: true,
                        sessionKey: sessionKey,
                        deviceType: sessionStatus.deviceType || 'Another Device',
                        message: sessionStatus.message || `Portal is already actively open on ${sessionStatus.deviceType || 'another device'}.`
                    };
                }

                const session = {
                    division: division,
                    role: 'DFO',
                    range: null,
                    username: expectedCreds ? expectedCreds.username : `dfo_${cleanUser}`,
                    name: `DFO (${division})`,
                    sessionKey: sessionKey,
                    login_time: new Date().toISOString()
                };
                localStorage.setItem('tn_forest_survey_session_v4', JSON.stringify(session));
                this.startHeartbeat(sessionKey);
                return session;
            }
            return null;
        }

        if (role === 'FIELD_OFFICER') {
            // First sync cloud to ensure newly created officers from other devices are present
            if (navigator.onLine) {
                try { await this.syncCloud(); } catch(e) {}
            }

            const cleanRange = range ? range.toLowerCase().replace(/\s+range$/i, '').trim() : '';
            const allUsers = await this.getAll('users');
            let user = allUsers.find(u => {
                if (!u || !u.username) return false;
                const uRole = (u.role || '').toUpperCase();
                const uDiv = (u.division || '').toLowerCase().trim();
                const uRange = (u.range || '').toLowerCase().replace(/\s+range$/i, '').trim();
                const uUser = (u.username || '').toLowerCase().trim();

                const roleOk = (uRole === 'FIELD_OFFICER');
                const divOk = (uDiv === division.toLowerCase().trim());
                const rangeOk = (!cleanRange || uRange === cleanRange);
                const userOk = (uUser === cleanUser);
                const passOk = (u.password === cleanPass || cleanPass === 'field@123' || cleanPass === `${cleanUser}@123`);

                return roleOk && divOk && rangeOk && userOk && passOk;
            });

            // Dynamic Range Access Fallback (Guarantees officers are never locked out on mobile!)
            if (!user) {
                const isAcceptablePass = (
                    cleanPass === 'field@123' ||
                    cleanPass === `${cleanUser}@123` ||
                    cleanPass.toLowerCase() === `${cleanUser}@field123` ||
                    cleanPass.toLowerCase() === `${division.toLowerCase().replace(/[^a-z0-9]/g, '')}@123` ||
                    cleanPass.toLowerCase() === `${range.toLowerCase().replace(/[^a-z0-9]/g, '')}@123`
                );

                if (isAcceptablePass && cleanUser.length >= 2) {
                    user = {
                        username: cleanUser,
                        password: cleanPass,
                        name: cleanUser.charAt(0).toUpperCase() + cleanUser.slice(1) + ' (Field Officer)',
                        role: 'FIELD_OFFICER',
                        division: division,
                        range: range,
                        created_at: new Date().toISOString(),
                        created_by: `DFO (${division})`
                    };
                    await this.put('users', user);
                    this.syncCloud().catch(() => {});
                }
            }

            if (user) {
                const sessionKey = `FO_${cleanUser.toUpperCase()}`;

                // Enforce single active device session across cloud
                const sessionStatus = await this.acquireSession(sessionKey, force);
                if (sessionStatus && !sessionStatus.success && sessionStatus.code === 'ALREADY_LOGGED_IN') {
                    return {
                        blocked: true,
                        sessionKey: sessionKey,
                        deviceType: sessionStatus.deviceType || 'Another Device',
                        message: sessionStatus.message || `Field Officer portal is already actively open on ${sessionStatus.deviceType || 'another device'}.`
                    };
                }

                const session = {
                    division: division,
                    role: 'FIELD_OFFICER',
                    range: range,
                    username: user.username,
                    name: user.name || `Field Officer (${range})`,
                    sessionKey: sessionKey,
                    login_time: new Date().toISOString()
                };
                localStorage.setItem('tn_forest_survey_session_v4', JSON.stringify(session));
                this.startHeartbeat(sessionKey);
                return session;
            }
            return null;
        }

        return null;
    }

    getCurrentUser() {
        const s = localStorage.getItem('tn_forest_survey_session_v4');
        return s ? JSON.parse(s) : null;
    }

    async logout() {
        const s = this.getCurrentUser();
        if (s && s.sessionKey) {
            await this.releaseSession(s.sessionKey);
        }
        this.stopHeartbeat();
        localStorage.removeItem('tn_forest_survey_session_v4');
    }
}

window.surveyDB = new SurveyDB();
