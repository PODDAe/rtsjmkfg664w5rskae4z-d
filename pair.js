const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const pino = require('pino');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay,
    Browsers
} = require('@whiskeysockets/baileys');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Simple ID generator for backward compatibility
function makeid(length = 6) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

class SessionManager {
    constructor() {
        this.activeSessions = new Map();
        this.sessionTimeout = 300000; // 5 minutes
    }

    createSession(sessionId, phone, ip) {
        const session = {
            id: sessionId,
            ip: ip,
            phone: phone,
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

    cleanupSession(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            // Close socket if exists
            if (session.socket && session.socket.ws) {
                try {
                    session.socket.ws.close();
                } catch (e) {}
            }
            
            // Remove temp files
            const tempDir = path.join(__dirname, 'temp', sessionId);
            if (fs.existsSync(tempDir)) {
                fs.removeSync(tempDir);
            }
            
            this.activeSessions.delete(sessionId);
        }
    }
}

const sessionManager = new SessionManager();

// Main pairing route
router.get('/', async (req, res) => {
    const phoneNumber = (req.query.number || '').replace(/\D/g, '');
    const requestId = uuidv4();
    const clientIP = req.ip || req.connection.remoteAddress;
    
    console.log(`📱 Pair request ${requestId} for ${phoneNumber}`);

    try {
        // Input validation
        if (!phoneNumber || phoneNumber.length < 10) {
            return res.status(400).json({
                requestId,
                error: 'VALIDATION_ERROR',
                message: 'Please provide a valid phone number with country code (e.g., 923123456789)'
            });
        }

        // Create session
        const sessionId = makeid(8);
        sessionManager.createSession(sessionId, phoneNumber, clientIP);

        // Start pairing process
        const pairingResult = await initiateWhatsAppPairing(phoneNumber, sessionId);
        
        if (pairingResult.success) {
            return res.json({
                requestId,
                success: true,
                code: pairingResult.code,
                message: 'Pairing code generated successfully',
                sessionId: sessionId,
                expiresIn: '5 minutes',
                instructions: [
                    '1. Open WhatsApp on your phone',
                    '2. Go to Settings > Linked Devices > Link a Device',
                    '3. Enter the 6-digit code shown above',
                    '4. Your session will be created automatically'
                ]
            });
        } else {
            sessionManager.cleanupSession(sessionId);
            return res.status(500).json({
                requestId,
                error: 'PAIRING_FAILED',
                message: pairingResult.error || 'Failed to generate pairing code'
            });
        }

    } catch (error) {
        console.error(`❌ Error in pairing process:`, error);
        return res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred. Please try again.'
        });
    }
});

async function initiateWhatsAppPairing(phoneNumber, sessionId) {
    const tempDir = path.join(__dirname, 'temp', sessionId);
    
    try {
        await fs.ensureDir(tempDir);
        
        const { state, saveCreds } = await useMultiFileAuthState(tempDir);
        
        // Configure logger
        const logger = pino({
            level: 'fatal',
            transport: {
                target: 'pino-pretty',
                options: { colorize: false }
            }
        });

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
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
        });

        // Update session with socket
        const session = sessionManager.activeSessions.get(sessionId);
        if (session) {
            session.socket = sock;
            session.status = 'connecting';
        }

        // Handle credentials update
        sock.ev.on('creds.update', saveCreds);

        // Handle connection events
        sock.ev.on('connection.update', async (update) => {
            const { connection } = update;
            
            if (connection === 'open') {
                console.log(`✅ Connected to WhatsApp for session ${sessionId}`);
                
                if (session) {
                    session.status = 'connected';
                }

                // Send welcome message
                await delay(2000);
                
                try {
                    const welcomeMessage = `✅ *DTZ NOVA XMD Session Activated!*\n\n` +
                        `▸ Session ID: ${sessionId}\n` +
                        `▸ Paired at: ${new Date().toLocaleString()}\n` +
                        `▸ Your number: ${phoneNumber}\n\n` +
                        `⚠️ *Do not share your session with anyone*\n\n` +
                        `🔗 Support: https://whatsapp.com/channel/0029Vb6mfVdEAKWH5Sgs9y2L`;
                    
                    await sock.sendMessage(sock.user.id, { text: welcomeMessage });
                    console.log(`📨 Welcome message sent for session ${sessionId}`);
                    
                } catch (msgError) {
                    console.error('Failed to send welcome message:', msgError);
                }

                // Close connection after successful pairing
                await delay(3000);
                try {
                    if (sock.ws && sock.ws.readyState !== 3) {
                        sock.ws.close();
                    }
                } catch (closeError) {}
                
            } else if (connection === 'close') {
                console.log(`🔌 Connection closed for session ${sessionId}`);
            }
        });

        // Request pairing code if not registered
        if (!state.creds.registered) {
            await delay(1500);
            
            try {
                console.log(`🔑 Requesting pairing code for ${phoneNumber}`);
                
                const pairingCode = await sock.requestPairingCode(phoneNumber);
                console.log(`✅ Pairing code generated: ${pairingCode}`);
                
                return {
                    success: true,
                    code: pairingCode
                };
            } catch (pairError) {
                console.error('❌ Pairing code request failed:', pairError);
                
                return {
                    success: false,
                    error: pairError.message || 'Failed to generate pairing code'
                };
            }
        }

        return {
            success: false,
            error: 'Already registered or unknown error'
        };

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
