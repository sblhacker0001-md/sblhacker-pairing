const express = require('express');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const fs = require('fs');
const Pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const activePairings = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [number, data] of activePairings.entries()) {
        if (now - data.timestamp > 5 * 60 * 1000) {
            try {
                if (data.sock) data.sock.end();
                if (data.sessionDir && fs.existsSync(data.sessionDir)) {
                    fs.rmSync(data.sessionDir, { recursive: true, force: true });
                }
            } catch(e) {}
            activePairings.delete(number);
        }
    }
}, 60 * 1000);

app.post('/api/pair', async (req, res) => {
    const { number } = req.body;
    
    if (!number) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    let cleanNumber = number.replace(/[^0-9]/g, '');
    if (cleanNumber.length === 10) {
        cleanNumber = '92' + cleanNumber;
    } else if (cleanNumber.length === 11 && cleanNumber.startsWith('0')) {
        cleanNumber = '92' + cleanNumber.slice(1);
    }

    try {
        const sessionId = Date.now().toString();
        const sessionDir = path.join(__dirname, 'temp_sessions', sessionId);
        
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: Pino({ level: 'silent' }),
            browser: ['SBLHACKER Bot', 'Chrome', '1.0.0'],
            defaultQueryTimeoutMs: undefined,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            version: [2, 3000, 1015901307]  // ← Fixed version
        });

        sock.ev.on('creds.update', saveCreds);

        // Wait a bit before requesting code
        await new Promise(r => setTimeout(r, 2000));
        
        const pairingCode = await sock.requestPairingCode(cleanNumber);
        
        activePairings.set(cleanNumber, {
            code: pairingCode,
            sock: sock,
            sessionDir: sessionDir,
            timestamp: Date.now()
        });

        setTimeout(() => {
            if (activePairings.has(cleanNumber)) {
                const data = activePairings.get(cleanNumber);
                try {
                    data.sock.end();
                    if (data.sessionDir && fs.existsSync(data.sessionDir)) {
                        fs.rmSync(data.sessionDir, { recursive: true, force: true });
                    }
                } catch(e) {}
                activePairings.delete(cleanNumber);
            }
        }, 5 * 60 * 1000);

        res.json({ success: true, code: pairingCode });
        
    } catch (error) {
        console.error('Pairing error:', error);
        res.status(500).json({ error: error.message || 'Failed to generate pairing code' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const tempDir = path.join(__dirname, 'temp_sessions');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

app.listen(PORT, () => {
    console.log(`🌐 Pairing API running on http://localhost:${PORT}`);
});
