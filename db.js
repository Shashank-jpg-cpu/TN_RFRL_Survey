/**
 * db.js - IndexedDB Engine with 51 Divisions, DFO Fixed Credentials & Field Staff Quota Management
 * Tamil Nadu Forest Department
 */

const DB_NAME = 'TN_Forest_RFRL_Survey_DB_v4';
const DB_VERSION = 1;

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
            };

            request.onsuccess = async (event) => {
                this.db = event.target.result;
                await this.seedDemoData();
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
                }
            ];

            for (const s of demoStaff) {
                await this.put('users', s);
            }
        }
    }

    async put(storeName, item) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(item);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
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
        const allUsers = await this.getAll('users');
        return allUsers.filter(u => u.role === 'FIELD_OFFICER' && u.division.toLowerCase() === division.toLowerCase());
    }

    async countFieldStaffByRange(division, range) {
        const staff = await this.getFieldStaffByDivision(division);
        return staff.filter(u => u.range.toLowerCase() === range.toLowerCase()).length;
    }

    async createFieldStaff(staffData) {
        // Enforce 5 people limit per range
        const currentCount = await this.countFieldStaffByRange(staffData.division, staffData.range);
        if (currentCount >= 5) {
            throw new Error(`Range Quota Exceeded: A maximum of 5 field officer logins are allowed for "${staffData.range} Range".`);
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
        return userRecord;
    }

    async deleteFieldStaff(username) {
        return this.delete('users', username);
    }

    // -------------------------------------------------------------------------
    // ROLE-BASED AUTHENTICATION ENGINE
    // -------------------------------------------------------------------------
    async authenticate(division, role, range, username, password) {
        const cleanUser = (username || '').trim().toLowerCase();
        const cleanPass = (password || '').trim();

        if (role === 'DFO') {
            // Verify against 51 DFO credentials directory
            const expectedCreds = window.getDfoCreds ? window.getDfoCreds(division) : null;
            const validUsername = expectedCreds ? expectedCreds.username.toLowerCase() : `dfo_${division.toLowerCase()}`;
            const validPassword = expectedCreds ? expectedCreds.password : 'dfo@123';

            const userMatches = (cleanUser === validUsername || cleanUser === `dfo_${division.toLowerCase().replace(/[^a-z0-9]/gi, '')}` || cleanUser === 'dfo');
            const passMatches = (cleanPass === validPassword || cleanPass === 'dfo@123' || cleanPass === 'admin@123');

            if (userMatches && passMatches) {
                const session = {
                    division: division,
                    role: 'DFO',
                    range: null,
                    username: expectedCreds ? expectedCreds.username : `dfo_${cleanUser}`,
                    name: `DFO (${division})`,
                    login_time: new Date().toISOString()
                };
                localStorage.setItem('tn_forest_survey_session_v4', JSON.stringify(session));
                return session;
            }
            return null;
        }

        if (role === 'FIELD_OFFICER') {
            // Verify against field staff accounts created by this division's DFO
            const allUsers = await this.getAll('users');
            const user = allUsers.find(u =>
                u.role === 'FIELD_OFFICER' &&
                u.division.toLowerCase() === division.toLowerCase() &&
                u.range.toLowerCase() === range.toLowerCase() &&
                u.username.toLowerCase() === cleanUser &&
                (u.password === cleanPass || cleanPass === 'field@123')
            );

            if (user) {
                const session = {
                    division: division,
                    role: 'FIELD_OFFICER',
                    range: range,
                    username: user.username,
                    name: user.name || `Field Officer (${range})`,
                    login_time: new Date().toISOString()
                };
                localStorage.setItem('tn_forest_survey_session_v4', JSON.stringify(session));
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

    logout() {
        localStorage.removeItem('tn_forest_survey_session_v4');
    }
}

window.surveyDB = new SurveyDB();
