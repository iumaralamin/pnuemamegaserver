const express = require('express');
const multer = require('multer');
const { Storage } = require('megajs');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

/* ================= ENV ================= */
const PORT = process.env.PORT || 3000;
const MEGA_EMAIL = process.env.MEGA_EMAIL;
const MEGA_PASSWORD = process.env.MEGA_PASSWORD;

if (!MEGA_EMAIL || !MEGA_PASSWORD) {
    console.error('❌ MEGA_EMAIL or MEGA_PASSWORD missing');
    process.exit(1);
}

/* ================= MEGA ================= */
let mega = null;

async function getMega() {
    if (!mega) {
        mega = new Storage({
            email: MEGA_EMAIL,
            password: MEGA_PASSWORD
        });
        await mega.ready;
        console.log('✅ Connected to MEGA');
    }
    return mega;
}

/* ================= MULTER ================= */
const upload = multer({ dest: 'uploads/' });

/* ================= HELPERS ================= */

// Resolve path like /books/a/b
function resolvePath(root, p) {
    if (p === '/' || !p) return root;
    const parts = p.split('/').filter(Boolean);
    let current = root;
    for (const part of parts) {
        current = Object.values(current.children || {}).find(
            f => f.name === part && f.directory
        );
        if (!current) return null;
    }
    return current;
}

// List folder
function listFolder(folder) {
    return Object.values(folder.children || {}).map(f => ({
        name: f.name,
        isFolder: !!f.directory,
        size: f.size || 0,
        handle: f.nodeId
    }));
}

/* ================= ROUTES ================= */

// Health check (REQUIRED for Render)
app.get('/', (req, res) => {
    res.send('✅ MEGA File Server is running');
});

/* ---------- LIST ---------- */
app.get('/list', async (req, res) => {
    try {
        const { folder = '/' } = req.query;
        const mega = await getMega();
        const target = resolvePath(mega.root, folder);

        if (!target) {
            return res.status(404).json({ error: 'Folder not found' });
        }

        res.json({
            path: folder,
            files: listFolder(target)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ---------- UPLOAD ---------- */
app.post('/upload-book', upload.single('file'), async (req, res) => {
    try {
        const { folder = '/', filename, description = '' } = req.body;
        const mega = await getMega();
        const parent = resolvePath(mega.root, folder);

        if (!parent) {
            return res.status(404).json({ error: 'Folder not found' });
        }

        const filePath = req.file.path;
        const size = fs.statSync(filePath).size;

        const stream = fs.createReadStream(filePath);
        const uploadTask = parent.upload(
            { name: filename || req.file.originalname, size },
            stream
        );

        const uploaded = await uploadTask.complete;

        fs.unlinkSync(filePath);

        res.json({
            success: true,
            name: uploaded.name,
            handle: uploaded.nodeId,
            size: uploaded.size,
            description,
            downloadUrl: `/download/${uploaded.nodeId}`
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ---------- DOWNLOAD ---------- */
app.get('/download/:handle', async (req, res) => {
    try {
        const mega = await getMega();
        const file = mega.files[req.params.handle];

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${file.name}"`
        );
        res.setHeader('Content-Length', file.size);
        file.download().pipe(res);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ---------- MOVE ---------- */
app.post('/move', async (req, res) => {
    try {
        const { source, destination } = req.body;
        const mega = await getMega();

        const srcFile = Object.values(mega.files).find(f => f.name === source);
        const destFolder = resolvePath(mega.root, destination);

        if (!srcFile || !destFolder) {
            return res.status(404).json({ error: 'Source or destination not found' });
        }

        await srcFile.moveTo(destFolder);

        res.json({ success: true, message: 'Moved successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ---------- COPY ---------- */
app.post('/copy', async (req, res) => {
    try {
        const { source, destination } = req.body;
        const mega = await getMega();

        const srcFile = Object.values(mega.files).find(f => f.name === source);
        const destFolder = resolvePath(mega.root, destination);

        if (!srcFile || !destFolder) {
            return res.status(404).json({ error: 'Source or destination not found' });
        }

        await srcFile.copyTo(destFolder);

        res.json({ success: true, message: 'Copied successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ================= START ================= */
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
