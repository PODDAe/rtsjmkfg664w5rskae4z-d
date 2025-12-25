[file name]: gen-id.js
[file content begin]
const { randomBytes, createHash } = require('crypto');
const { v4: uuidv4 } = require('uuid');

/**
 * Generate a unique session ID
 */
function generateSessionId(length = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const bytes = randomBytes(length);
    
    for (let i = 0; i < length; i++) {
        result += chars[bytes[i] % chars.length];
    }
    
    return result;
}

/**
 * Generate a secure pairing code
 */
function generatePairingCode() {
    const chars = '0123456789';
    let code = '';
    const bytes = randomBytes(6);
    
    for (let i = 0; i < 6; i++) {
        code += chars[bytes[i] % chars.length];
    }
    
    return code.match(/.{1,3}/g).join('-'); // Format: XXX-XXX
}

/**
 * Generate a unique request ID
 */
function generateRequestId() {
    return uuidv4();
}

/**
 * Hash phone number for logging (privacy)
 */
function hashPhoneNumber(phone) {
    return createHash('sha256').update(phone).digest('hex').slice(0, 16);
}

/**
 * Validate phone number format
 */
function validatePhoneNumber(phone) {
    const cleaned = phone.replace(/\D/g, '');
    
    if (!cleaned) return false;
    if (cleaned.length < 10 || cleaned.length > 15) return false;
    
    // Ensure it starts with country code
    return cleaned.startsWith('1') || cleaned.startsWith('2') || 
           cleaned.startsWith('3') || cleaned.startsWith('4') ||
           cleaned.startsWith('5') || cleaned.startsWith('6') ||
           cleaned.startsWith('7') || cleaned.startsWith('8') ||
           cleaned.startsWith('9') ? cleaned : false;
}

module.exports = {
    generateSessionId,
    generatePairingCode,
    generateRequestId,
    hashPhoneNumber,
    validatePhoneNumber,
    makeid: generateSessionId // Backward compatibility
};
[file content end]
