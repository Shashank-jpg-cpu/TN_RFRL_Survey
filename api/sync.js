// api/sync.js - Vercel Serverless Sync API for TN Forest RF/RL Survey Platform
// Handles bi-directional synchronization of staff accounts, boundaries, and surveys across all devices

let cloudStore = {
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
    last_synced: new Date().toISOString()
};

export default async function handler(req, res) {
    // Enable CORS for web and mobile devices
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method === 'GET') {
        return res.status(200).json({
            success: true,
            data: cloudStore,
            timestamp: new Date().toISOString()
        });
    }

    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

            // 1. Merge Users uniquely by username
            if (body.users && Array.isArray(body.users)) {
                const userMap = new Map();
                cloudStore.users.forEach(u => userMap.set(u.username.toLowerCase(), u));
                body.users.forEach(u => {
                    if (u && u.username) {
                        userMap.set(u.username.toLowerCase(), u);
                    }
                });
                cloudStore.users = Array.from(userMap.values());
            }

            // 2. Merge Polygons uniquely by ID
            if (body.polygons && Array.isArray(body.polygons)) {
                const polyMap = new Map();
                cloudStore.polygons.forEach(p => polyMap.set(p.id, p));
                body.polygons.forEach(p => {
                    if (p && p.id) {
                        polyMap.set(p.id, p);
                    }
                });
                cloudStore.polygons = Array.from(polyMap.values());
            }

            // 3. Merge Pending Surveys uniquely by ID
            if (body.pending_surveys && Array.isArray(body.pending_surveys)) {
                const survMap = new Map();
                cloudStore.pending_surveys.forEach(s => survMap.set(s.id, s));
                body.pending_surveys.forEach(s => {
                    if (s && s.id) {
                        survMap.set(s.id, s);
                    }
                });
                cloudStore.pending_surveys = Array.from(survMap.values());
            }

            cloudStore.last_synced = new Date().toISOString();

            return res.status(200).json({
                success: true,
                message: 'Cloud sync completed successfully',
                data: cloudStore
            });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
