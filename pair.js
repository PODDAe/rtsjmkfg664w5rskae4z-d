const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const pino = require('pino');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay,
    DisconnectReason,
    Browsers
} = require('@whiskeysockets/baileys');
const { 
    generateSessionId, 
    generateRequestId, 
    hashPhoneNumber, 
    validatePhoneNumber 
} = require('./gen-id');

const router = express.Router();

// Session management class
class SessionManager {
    constructor() {
        this.activeSessions = new Map();
        this.sessionTimeout = parseInt(process.env.SESSION_TIMEOUT) || 300000; // 5 minutes
        this.maxSessionsPerIP = parseInt(process.env.MAX_SESSIONS_PER_IP) || 3;
        this.sessionsDir = path.join(__dirname, 'sessions', 'active');
        fs.ensureDirSync(this.sessionsDir);
    }

    canCreateSession(ip) {
        const userSessions = Array.from(this.activeSessions.values())
            .filter(session => session.ip === ip);
        return userSessions.length < this.maxSessionsPerIP;
    }

    createSession(sessionId, data) {
        const session = {
            id: sessionId,
            ip: data.ip,
            phone: data.phone,
            startedAt: Date.now(),
            status: 'initializing',
            socket: null
        };

        this.activeSessions.set(sessionId, session);
        
        // Auto-cleanup after timeout
        setTimeout(() => {
            this.cleanupSession(sessionId);
        }, this.sessionTimeout);

        return session;
    }

    updateSession(sessionId, updates) {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            Object.assign(session, updates);
            this.activeSessions.set(sessionId, session);
        }
    }

    cleanupSession(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            console.log(`🧹 Cleaning up session ${sessionId} for ${hashPhoneNumber(session.phone)}`);
            
            // Close socket if exists
            if (session.socket && session.socket.ws) {
                try {
                    session.socket.ws.close();
                } catch (e) {
                    // Ignore
                }
            }
            
            // Remove temp files
            const tempDir = path.join(__dirname, 'temp', sessionId);
            if (fs.existsSync(tempDir)) {
                fs.removeSync(tempDir);
            }
            
            this.activeSessions.delete(sessionId);
            
            // Move to expired
            const expiredDir = path.join(__dirname, 'sessions', 'expired');
            fs.ensureDirSync(expiredDir);
            const sessionFile = path.join(expiredDir, `${sessionId}.json`);
            fs.writeJsonSync(sessionFile, {
                ...session,
                endedAt: Date.now(),
                duration: Date.now() - session.startedAt
            });
        }
    }

    getStats() {
        return {
            total: this.activeSessions.size,
            byStatus: Array.from(this.activeSessions.values())
                .reduce((acc, session) => {
                    acc[session.status] = (acc[session.status] || 0) + 1;
                    return acc;
                }, {}),
            recent: Array.from(this.activeSessions.values())
                .slice(-5)
                .map(s => ({
                    id: s.id,
                    phone: hashPhoneNumber(s.phone),
                    status: s.status,
                    age: Math.floor((Date.now() - s.startedAt) / 1000)
                }))
        };
    }
}

const sessionManager = new SessionManager();

// Routes
router.get('/', async (req, res) => {
    const phoneNumber = (req.query.number || '').replace(/\D/g, '');
    const requestId = generateRequestId();
    const clientIP = req.ip || req.connection.remoteAddress;
    
    console.log(`📱 Pair request ${requestId} from ${clientIP} for ${hashPhoneNumber(phoneNumber)}`);

    try {
        // Input validation
        if (!phoneNumber) {
            return res.status(400).json({
                requestId,
                error: 'VALIDATION_ERROR',
                message: 'Phone number is required'
            });
        }

        const validatedPhone = validatePhoneNumber(phoneNumber);
        if (!validatedPhone) {
            return res.status(400).json({
                requestId,
                error: 'VALIDATION_ERROR',
                message: 'Invalid phone number format. Use format: 923123456789'
            });
        }

        // Check rate limits
        if (!sessionManager.canCreateSession(clientIP)) {
            return res.status(429).json({
                requestId,
                error: 'RATE_LIMIT_EXCEEDED',
                message: `Maximum ${sessionManager.maxSessionsPerIP} sessions per IP allowed`
            });
        }

        // Create session
        const sessionId = generateSessionId();
        sessionManager.createSession(sessionId, {
            ip: clientIP,
            phone: validatedPhone
        });

        // Start pairing process
        const pairingResult = await initiateWhatsAppPairing(
            validatedPhone, 
            sessionId, 
            requestId
        );

        if (pairingResult.success) {
            sessionManager.updateSession(sessionId, {
                status: 'paired',
                pairingCode: pairingResult.code
            });

            return res.json({
                requestId,
                success: true,
                code: pairingResult.code,
                message: pairingResult.message,
                sessionId,
                expiresIn: Math.floor(sessionManager.sessionTimeout / 60000) + ' minutes',
                instructions: [
                    '1. Open WhatsApp on your phone',
                    '2. Go to Settings > Linked Devices > Link a Device',
                    '3. Enter the code above',
                    '4. Your session will be created automatically'
                ]
            });
        } else {
            sessionManager.updateSession(sessionId, {
                status: 'failed',
                error: pairingResult.error
            });

            return res.status(500).json({
                requestId,
                error: 'PAIRING_FAILED',
                message: pairingResult.error
            });
        }

    } catch (error) {
        console.error(`❌ Error in pairing process ${requestId}:`, error);
        
        return res.status(500).json({
            requestId,
            error: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred. Please try again.'
        });
    }
});

// Stats endpoint
router.get('/stats', (req, res) => {
    if (req.query.key !== process.env.STATS_KEY) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    res.json({
        timestamp: new Date().toISOString(),
        server: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            nodeVersion: process.version
        },
        sessions: sessionManager.getStats(),
        limits: {
            maxSessionsPerIP: sessionManager.maxSessionsPerIP,
            sessionTimeout: sessionManager.sessionTimeout
        }
    });
});

// Cleanup endpoint
router.post('/cleanup', (req, res) => {
    if (req.query.key !== process.env.CLEANUP_KEY) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const sessionId = req.body.sessionId;
    if (sessionId) {
        sessionManager.cleanupSession(sessionId);
        res.json({ success: true, message: `Session ${sessionId} cleaned up` });
    } else {
        res.json({ 
            success: true, 
            message: 'Use ?sessionId=ID to clean specific session' 
        });
    }
});

async function initiateWhatsAppPairing(phoneNumber, sessionId, requestId) {
    const tempDir = path.join(__dirname, 'temp', sessionId);
    
    try {
        await fs.ensureDir(tempDir);
        
        const { state, saveCreds } = await useMultiFileAuthState(tempDir);
        
        // Configure logger
        const logger = pino({
            level: process.env.ENABLE_DEBUG === 'true' ? 'debug' : 'fatal',
            transport: process.env.ENABLE_DEBUG === 'true' ? {
                target: 'pino-pretty',
                options: { colorize: true }
            } : undefined
        }).child({ sessionId, requestId });

        // Create WhatsApp socket
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: state.keys,
            },
            logger,
            printQRInTerminal: false,
            browser: Browsers.macOS('Safari'),
            version: [2, 2412, 54],
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
            defaultQueryTimeoutMs: 0,
            emitOwnEvents: true,
            fireInitQueries: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            markOnlineOnConnect: true,
            linkPreviewImageThumbnailWidth: 192,
        });

        // Update session with socket
        sessionManager.updateSession(sessionId, { socket: sock });

        // Handle credentials update
        sock.ev.on('creds.update', saveCreds);

        // Handle connection events
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            logger.info(`Connection update: ${connection}`);

            if (connection === 'open') {
                logger.info('✅ Connected to WhatsApp');
                sessionManager.updateSession(sessionId, { status: 'connected' });

                // Send welcome message
                await delay(2000);
                
                try {
                    const welcomeMessage = `✅ *DTZ NOVA XMD Session Activated!*\n\n` +
                        `▸ Session ID: ${sessionId}\n` +
                        `▸ Paired at: ${new Date().toLocaleString()}\n` +
                        `▸ Your number: ${phoneNumber}\n\n` +
                        `⚠️ *Security Notice:*\n` +
                        `• Never share your session\n` +
                        `• Session will auto-expire\n` +
                        `• Contact support if needed\n\n` +
                        `🔗 Support: https://whatsapp.com/channel/0029Vb6mfVdEAKWH5Sgs9y2L`;
                    
                    await sock.sendMessage(sock.user.id, { text: welcomeMessage });
                    logger.info('Welcome message sent');
                    
                } catch (msgError) {
                    logger.error('Failed to send welcome message:', msgError);
                }

                // Close connection after successful pairing
                await delay(5000);
                try {
                    if (sock.ws && sock.ws.readyState !== 3) { // Not CLOSED
                        sock.ws.close();
                    }
                } catch (closeError) {
                    // Ignore close errors
                }
                
                // Cleanup after a delay
                setTimeout(() => {
                    sessionManager.cleanupSession(sessionId);
                }, 10000);

            } else if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const error = lastDisconnect?.error;
                
                logger.warn(`Connection closed: ${statusCode || 'Unknown'}`);
                
                if (statusCode === DisconnectReason.loggedOut) {
                    sessionManager.updateSession(sessionId, { 
                        status: 'logged_out',
                        error: 'Logged out from WhatsApp'
                    });
                } else if (error) {
                    sessionManager.updateSession(sessionId, { 
                        status: 'disconnected',
                        error: error.message 
                    });
                }
            }
        });

        // Request pairing code
        if (!state.creds.registered) {
            await delay(2000);
            
            try {
                logger.info(`Requesting pairing code for ${phoneNumber}`);
                
                const pairingCode = await sock.requestPairingCode(phoneNumber);
                logger.info(`Pairing code generated: ${pairingCode}`);
                
                return {
                    success: true,
                    code: pairingCode,
                    message: 'Pairing code generated successfully'
                };
            } catch (pairError) {
                logger.error('Pairing code request failed:', pairError);
                
                return {
                    success: false,
                    error: pairError.message || 'Failed to generate pairing code'
                };
            }
        }

    } catch (error) {
        console.error(`🚨 WhatsApp connection error (${sessionId}):`, error);
        
        // Cleanup on error
        if (fs.existsSync(tempDir)) {
            await fs.remove(tempDir);
        }
        
        return {
            success: false,
            error: error.message || 'WhatsApp connection failed'
        };
    }
}

module.exports = router;
[file content end]
