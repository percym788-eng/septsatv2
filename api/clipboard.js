// api/clipboard.js - Screenshot Clipboard Management API
import fs from 'fs/promises';
import path from 'path';

// Storage paths
const SCREENSHOTS_DIR = path.join(process.cwd(), 'data', 'screenshots');
const CLIPBOARD_INDEX_FILE = path.join(process.cwd(), 'data', 'clipboard-index.json');

// Hardcoded admin key for clipboard access
const HARDCODED_ADMIN_KEY = "122316";

// Ensure directories exist
async function ensureDirectories() {
    try {
        await fs.mkdir(path.join(process.cwd(), 'data'), { recursive: true });
        await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
    } catch (error) {
        console.log('Directories already exist or created');
    }
}

// Load clipboard index
async function loadClipboardIndex() {
    try {
        const data = await fs.readFile(CLIPBOARD_INDEX_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // Return empty index if file doesn't exist
        return {
            users: {},
            totalScreenshots: 0,
            lastUpdated: null
        };
    }
}

// Save clipboard index
async function saveClipboardIndex(index) {
    await fs.writeFile(CLIPBOARD_INDEX_FILE, JSON.stringify(index, null, 2));
}

// Validate admin access for clipboard viewing
function validateClipboardAccess(req) {
    const adminKey = req.headers['x-admin-key'] || req.body?.adminKey;
    return adminKey === HARDCODED_ADMIN_KEY;
}

// Validate regular admin access (for MAC management)
function validateAdminAccess(req) {
    const adminKey = req.headers['x-admin-key'] || req.body?.adminKey;
    const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || "default-admin-key-change-this";
    return adminKey === ADMIN_SECRET_KEY;
}

// Generate unique screenshot ID
function generateScreenshotId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

export default async function handler(req, res) {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    await ensureDirectories();
    
    const { action } = req.query;
    
    try {
        switch (action) {
            case 'upload-screenshot':
                return await handleScreenshotUpload(req, res);
            case 'list-users':
                return await handleListUsers(req, res);
            case 'get-user-screenshots':
                return await handleGetUserScreenshots(req, res);
            case 'get-screenshot':
                return await handleGetScreenshot(req, res);
            case 'delete-screenshot':
                return await handleDeleteScreenshot(req, res);
            case 'clear-user-clipboard':
                return await handleClearUserClipboard(req, res);
            case 'get-stats':
                return await handleGetStats(req, res);
            default:
                return res.status(400).json({
                    success: false,
                    message: 'Invalid action. Available: upload-screenshot, list-users, get-user-screenshots, get-screenshot, delete-screenshot, clear-user-clipboard, get-stats'
                });
        }
    } catch (error) {
        console.error('Clipboard API Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
}

// Handle screenshot upload (no admin key required - devices upload automatically)
async function handleScreenshotUpload(req, res) {
    const { 
        userId, 
        username, 
        deviceId, 
        hostname, 
        platform, 
        accessType, 
        timestamp, 
        macAddresses, 
        imageData,
        sessionInfo 
    } = req.body;

    if (!userId || !imageData || !username) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields: userId, username, imageData'
        });
    }

    try {
        const screenshotId = generateScreenshotId();
        const screenshotFileName = `${screenshotId}.png`;
        const screenshotPath = path.join(SCREENSHOTS_DIR, screenshotFileName);

        // Save screenshot file
        const imageBuffer = Buffer.from(imageData, 'base64');
        await fs.writeFile(screenshotPath, imageBuffer);

        // Load and update clipboard index
        const index = await loadClipboardIndex();
        
        if (!index.users[userId]) {
            index.users[userId] = {
                username: username,
                deviceInfo: {
                    hostname: hostname,
                    platform: platform,
                    deviceId: deviceId,
                    macAddresses: macAddresses
                },
                screenshots: [],
                firstSeen: new Date().toISOString(),
                lastActive: new Date().toISOString(),
                totalScreenshots: 0
            };
        }

        // Add screenshot to user's clipboard
        const screenshotEntry = {
            id: screenshotId,
            filename: screenshotFileName,
            timestamp: timestamp || Date.now(),
            uploadedAt: new Date().toISOString(),
            accessType: accessType,
            sessionInfo: sessionInfo || {},
            size: imageBuffer.length
        };

        index.users[userId].screenshots.push(screenshotEntry);
        index.users[userId].lastActive = new Date().toISOString();
        index.users[userId].totalScreenshots++;
        
        // Keep only last 100 screenshots per user to prevent unlimited storage
        if (index.users[userId].screenshots.length > 100) {
            const oldScreenshots = index.users[userId].screenshots.splice(0, index.users[userId].screenshots.length - 100);
            
            // Delete old screenshot files
            for (const oldScreenshot of oldScreenshots) {
                try {
                    await fs.unlink(path.join(SCREENSHOTS_DIR, oldScreenshot.filename));
                } catch (error) {
                    console.log(`Could not delete old screenshot: ${oldScreenshot.filename}`);
                }
            }
        }

        index.totalScreenshots++;
        index.lastUpdated = new Date().toISOString();

        await saveClipboardIndex(index);

        console.log(`Screenshot uploaded: ${screenshotId} for user ${userId}`);

        return res.status(200).json({
            success: true,
            message: 'Screenshot uploaded successfully',
            screenshotId: screenshotId,
            userId: userId
        });

    } catch (error) {
        console.error('Upload error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to upload screenshot',
            error: error.message
        });
    }
}

// List all users (clipboard admin access required)
async function handleListUsers(req, res) {
    if (!validateClipboardAccess(req)) {
        return res.status(403).json({
            success: false,
            message: 'Clipboard access denied. Correct admin key required.'
        });
    }

    const index = await loadClipboardIndex();
    
    const userList = Object.entries(index.users).map(([userId, userData]) => ({
        userId: userId,
        username: userData.username,
        deviceInfo: userData.deviceInfo,
        totalScreenshots: userData.screenshots.length,
        firstSeen: userData.firstSeen,
        lastActive: userData.lastActive,
        latestScreenshot: userData.screenshots.length > 0 ? 
            userData.screenshots[userData.screenshots.length - 1].uploadedAt : null
    }));

    return res.status(200).json({
        success: true,
        message: 'Users retrieved successfully',
        data: {
            users: userList,
            totalUsers: userList.length,
            totalScreenshots: index.totalScreenshots
        }
    });
}

// Get screenshots for a specific user (clipboard admin access required)
async function handleGetUserScreenshots(req, res) {
    if (!validateClipboardAccess(req)) {
        return res.status(403).json({
            success: false,
            message: 'Clipboard access denied. Correct admin key required.'
        });
    }

    const { userId } = req.query;
    if (!userId) {
        return res.status(400).json({
            success: false,
            message: 'userId parameter required'
        });
    }

    const index = await loadClipboardIndex();
    
    if (!index.users[userId]) {
        return res.status(404).json({
            success: false,
            message: 'User not found'
        });
    }

    const userData = index.users[userId];
    
    return res.status(200).json({
        success: true,
        message: 'User screenshots retrieved successfully',
        data: {
            userId: userId,
            username: userData.username,
            deviceInfo: userData.deviceInfo,
            screenshots: userData.screenshots.reverse(), // Most recent first
            totalScreenshots: userData.screenshots.length
        }
    });
}

// Get specific screenshot (clipboard admin access required)
async function handleGetScreenshot(req, res) {
    if (!validateClipboardAccess(req)) {
        return res.status(403).json({
            success: false,
            message: 'Clipboard access denied. Correct admin key required.'
        });
    }

    const { screenshotId, userId } = req.query;
    if (!screenshotId || !userId) {
        return res.status(400).json({
            success: false,
            message: 'screenshotId and userId parameters required'
        });
    }

    const index = await loadClipboardIndex();
    
    if (!index.users[userId]) {
        return res.status(404).json({
            success: false,
            message: 'User not found'
        });
    }

    const screenshot = index.users[userId].screenshots.find(s => s.id === screenshotId);
    
    if (!screenshot) {
        return res.status(404).json({
            success: false,
            message: 'Screenshot not found'
        });
    }

    try {
        const screenshotPath = path.join(SCREENSHOTS_DIR, screenshot.filename);
        const imageBuffer = await fs.readFile(screenshotPath);
        
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Length', imageBuffer.length);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        
        return res.status(200).send(imageBuffer);
        
    } catch (error) {
        return res.status(404).json({
            success: false,
            message: 'Screenshot file not found',
            error: error.message
        });
    }
}

// Delete specific screenshot (clipboard admin access required)
async function handleDeleteScreenshot(req, res) {
    if (!validateClipboardAccess(req)) {
        return res.status(403).json({
            success: false,
            message: 'Clipboard access denied. Correct admin key required.'
        });
    }

    const { screenshotId, userId } = req.body;
    if (!screenshotId || !userId) {
        return res.status(400).json({
            success: false,
            message: 'screenshotId and userId required'
        });
    }

    try {
        const index = await loadClipboardIndex();
        
        if (!index.users[userId]) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const screenshotIndex = index.users[userId].screenshots.findIndex(s => s.id === screenshotId);
        
        if (screenshotIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Screenshot not found'
            });
        }

        const screenshot = index.users[userId].screenshots[screenshotIndex];
        
        // Delete file
        try {
            await fs.unlink(path.join(SCREENSHOTS_DIR, screenshot.filename));
        } catch (error) {
            console.log(`Could not delete screenshot file: ${screenshot.filename}`);
        }

        // Remove from index
        index.users[userId].screenshots.splice(screenshotIndex, 1);
        index.totalScreenshots--;
        index.lastUpdated = new Date().toISOString();

        await saveClipboardIndex(index);

        return res.status(200).json({
            success: true,
            message: 'Screenshot deleted successfully'
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Failed to delete screenshot',
            error: error.message
        });
    }
}

// Clear all screenshots for a user (clipboard admin access required)
async function handleClearUserClipboard(req, res) {
    if (!validateClipboardAccess(req)) {
        return res.status(403).json({
            success: false,
            message: 'Clipboard access denied. Correct admin key required.'
        });
    }

    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({
            success: false,
            message: 'userId required'
        });
    }

    try {
        const index = await loadClipboardIndex();
        
        if (!index.users[userId]) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const screenshots = index.users[userId].screenshots;
        
        // Delete all screenshot files for this user
        for (const screenshot of screenshots) {
            try {
                await fs.unlink(path.join(SCREENSHOTS_DIR, screenshot.filename));
            } catch (error) {
                console.log(`Could not delete screenshot file: ${screenshot.filename}`);
            }
        }

        // Update index
        index.totalScreenshots -= screenshots.length;
        index.users[userId].screenshots = [];
        index.lastUpdated = new Date().toISOString();

        await saveClipboardIndex(index);

        return res.status(200).json({
            success: true,
            message: `Cleared ${screenshots.length} screenshots for user ${userId}`
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Failed to clear user clipboard',
            error: error.message
        });
    }
}

// Get clipboard statistics (clipboard admin access required)
async function handleGetStats(req, res) {
    if (!validateClipboardAccess(req)) {
        return res.status(403).json({
            success: false,
            message: 'Clipboard access denied. Correct admin key required.'
        });
    }

    const index = await loadClipboardIndex();
    
    const stats = {
        totalUsers: Object.keys(index.users).length,
        totalScreenshots: index.totalScreenshots,
        lastUpdated: index.lastUpdated,
        userStats: Object.entries(index.users).map(([userId, userData]) => ({
            userId,
            username: userData.username,
            screenshotCount: userData.screenshots.length,
            lastActive: userData.lastActive,
            deviceInfo: userData.deviceInfo
        }))
    };

    return res.status(200).json({
        success: true,
        message: 'Statistics retrieved successfully',
        data: stats
    });
}
