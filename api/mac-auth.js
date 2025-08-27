// api/mac-auth.js - Simple File-Based MAC Authentication
import fs from 'fs/promises';
import path from 'path';

// File paths
const MAC_FILE_PATH = path.join(process.cwd(), 'data', 'mac-addresses.txt');
const ACCESS_TYPES_FILE = path.join(process.cwd(), 'data', 'access-types.txt');

// Cache for performance
let macCache = null;
let accessTypeCache = null;
let lastCacheTime = 0;
const CACHE_DURATION = 5000; // 5 seconds

// Load MAC addresses from file
async function loadMACAddresses() {
    const now = Date.now();
    
    // Use cache if recent
    if (macCache && accessTypeCache && (now - lastCacheTime) < CACHE_DURATION) {
        return { macAddresses: macCache, accessTypes: accessTypeCache };
    }
    
    try {
        // Load MAC addresses
        const macData = await fs.readFile(MAC_FILE_PATH, 'utf8');
        const macAddresses = macData
            .split('\n')
            .map(line => line.trim().toLowerCase())
            .filter(line => line && !line.startsWith('#'));
        
        // Load access types (format: mac_address=access_type)
        let accessTypes = new Map();
        try {
            const accessData = await fs.readFile(ACCESS_TYPES_FILE, 'utf8');
            accessData
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'))
                .forEach(line => {
                    const [mac, type] = line.split('='); // Changed from ':' to '='
                    if (mac && type) {
                        accessTypes.set(mac.toLowerCase(), type.trim());
                    }
                });
        } catch (error) {
            console.log('Access types file not found, using defaults');
        }
        
        // Update cache
        macCache = new Set(macAddresses);
        accessTypeCache = accessTypes;
        lastCacheTime = now;
        
        console.log(`Loaded ${macAddresses.length} MAC addresses from file`);
        console.log(`Loaded ${accessTypes.size} access type entries`); // Added debug log
        return { macAddresses: macCache, accessTypes: accessTypeCache };
        
    } catch (error) {
        console.error('Error loading MAC addresses:', error.message);
        // Return empty set if file doesn't exist or can't be read
        macCache = new Set();
        accessTypeCache = new Map();
        lastCacheTime = now;
        return { macAddresses: macCache, accessTypes: accessTypeCache };
    }
}

// Validate admin key
function validateAdminKey(providedKey) {
    const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || "default-admin-key-change-this";
    return providedKey === ADMIN_SECRET_KEY;
}

// Main API handler
export default async function handler(req, res) {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    const { action } = req.query;
    
    try {
        switch (action) {
            case 'check-access':
                return await handleCheckAccess(req, res);
            case 'list-macs':
                return await handleListMACs(req, res);
            case 'health':
                return await handleHealthCheck(req, res);
            default:
                return res.status(400).json({
                    success: false,
                    message: 'Invalid action. Available actions: check-access, list-macs, health'
                });
        }
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
}

// Health check endpoint
async function handleHealthCheck(req, res) {
    const { macAddresses, accessTypes } = await loadMACAddresses();
    
    return res.status(200).json({
        success: true,
        message: 'API is healthy',
        data: {
            totalMACs: macAddresses.size,
            totalAccessTypes: accessTypes.size, // Added this for debugging
            cacheAge: Date.now() - lastCacheTime,
            timestamp: new Date().toISOString()
        }
    });
}

// Check if MAC address has access
async function handleCheckAccess(req, res) {
    const { macAddresses: requestMacs, deviceInfo } = req.body;
    
    if (!requestMacs || !Array.isArray(requestMacs) || requestMacs.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'MAC addresses are required'
        });
    }
    
    const { macAddresses, accessTypes } = await loadMACAddresses();
    
    // Check if any of the provided MAC addresses are authorized
    let authorizedMac = null;
    for (const mac of requestMacs) {
        const normalizedMac = mac.toLowerCase();
        if (macAddresses.has(normalizedMac)) {
            authorizedMac = normalizedMac;
            break;
        }
    }
    
    if (!authorizedMac) {
        return res.status(403).json({
            success: false,
            message: 'Device not authorized. MAC address not in whitelist.',
            data: null
        });
    }
    
    // Get access type (default to trial if not specified)
    const accessType = accessTypes.get(authorizedMac) || 'trial';
    
    // Debug logging
    console.log(`MAC: ${authorizedMac}, Access Type: ${accessType}`);
    console.log(`Access types map:`, Array.from(accessTypes.entries()));
    
    return res.status(200).json({
        success: true,
        message: 'Device authorized',
        data: {
            macAddress: authorizedMac,
            accessType: accessType,
            authorizedAt: new Date().toISOString()
        }
    });
}

// List all MAC addresses (admin only)
async function handleListMACs(req, res) {
    const { adminKey } = req.body;
    
    if (!validateAdminKey(adminKey)) {
        return res.status(403).json({
            success: false,
            message: 'Invalid admin key'
        });
    }
    
    const { macAddresses, accessTypes } = await loadMACAddresses();
    
    const macList = Array.from(macAddresses).map(mac => ({
        macAddress: mac,
        accessType: accessTypes.get(mac) || 'trial'
    }));
    
    return res.status(200).json({
        success: true,
        message: 'MAC addresses retrieved successfully',
        data: {
            macAddresses: macList,
            total: macList.length
        }
    });
}
