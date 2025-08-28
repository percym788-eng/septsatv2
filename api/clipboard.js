// api/clipboard.js - Screenshot Clipboard Management API with Vercel Blob + Admin Features
import { put, del, list } from '@vercel/blob';

// Hardcoded admin key for clipboard access
const HARDCODED_ADMIN_KEY = "122316";

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

// In-memory storage for clipboard index (since we can't use filesystem)
// In production, this would be stored in a database
let clipboardIndex = {
    users: {},
    totalScreenshots: 0,
    lastUpdated: null
};

export default async function handler(req, res) {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

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
            case 'health':
                return await handleHealthCheck(req, res);
            default:
                return res.status(400).json({
                    success: false,
                    message: 'Invalid action. Available: upload-screenshot, list-users, get-user-screenshots, get-screenshot, delete-screenshot, clear-user-clipboard, get-stats, health'
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
        const fileName = `screenshots/${userId}/${screenshotId}.png`;
        
        // Convert base64 to buffer
        const imageBuffer = Buffer.from(imageData, 'base64');
        
        // Upload image to Vercel Blob
        const blob = await put(fileName, imageBuffer, {
            access: 'public',
            contentType: 'image/png',
        });

        // Update in-memory clipboard index
        if (!clipboardIndex.users[userId]) {
            clipboardIndex.users[userId] = {
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
            filename: fileName,
            timestamp: timestamp || Date.now(),
            uploadedAt: new Date().toISOString(),
            accessType: accessType,
            sessionInfo: sessionInfo || {},
            size: imageBuffer.length,
            blobUrl: blob.url
        };

        clipboardIndex.users[userId].screenshots.push(screenshotEntry);
        clipboardIndex.users[userId].lastActive = new Date().toISOString();
        clipboardIndex.users[userId].totalScreenshots++;
        
        // Keep only last 50 screenshots per user to manage storage
        if (clipboardIndex.users[userId].screenshots.length > 50) {
            const oldScreenshots = clipboardIndex.users[userId].screenshots.splice(0, clipboardIndex.users[userId].screenshots.length - 50);
            
            // Delete old screenshot files from Blob
            for (const oldScreenshot of oldScreenshots) {
                try {
                    await del(oldScreenshot.blobUrl);
                } catch (error) {
                    console.log(`Could not delete old screenshot: ${oldScreenshot.filename}`);
                }
            }
        }

        clipboardIndex.totalScreenshots++;
        clipboardIndex.lastUpdated = new Date().toISOString();

        console.log(`Screenshot uploaded to Blob: ${screenshotId} for user ${userId}`);
        console.log(`Blob URL: ${blob.url}`);

        return res.status(200).json({
            success: true,
            message: 'Screenshot uploaded successfully',
            screenshotId: screenshotId,
            userId: userId,
            blobUrl: blob.url
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

    try {
        // Get all blobs from storage
        const { blobs } = await list();
        
        // Extract unique user IDs from blob paths
        const userIds = [...new Set(
            blobs
                .filter(blob => blob.pathname.startsWith('screenshots/'))
                .map(blob => blob.pathname.split('/')[1])
                .filter(userId => userId && userId !== '')
        )];

        const userList = userIds.map(userId => {
            // Get user blobs
            const userBlobs = blobs.filter(blob => 
                blob.pathname.startsWith(`screenshots/${userId}/`)
            );

            // Get user data from memory or create fallback
            const userData = clipboardIndex.users[userId] || {
                username: userId,
                deviceInfo: {},
                firstSeen: userBlobs.length > 0 ? userBlobs[userBlobs.length - 1].uploadedAt : new Date().toISOString(),
                lastActive: userBlobs.length > 0 ? userBlobs[0].uploadedAt : new Date().toISOString()
            };

            return {
                userId: userId,
                username: userData.username,
                deviceInfo: userData.deviceInfo,
                totalScreenshots: userBlobs.length,
                firstSeen: userData.firstSeen,
                lastActive: userData.lastActive,
                latestScreenshot: userBlobs.length > 0 ? 
                    userBlobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0].uploadedAt : null
            };
        });

        return res.status(200).json({
            success: true,
            message: 'Users retrieved successfully',
            data: {
                users: userList,
                totalUsers: userList.length,
                totalScreenshots: blobs.filter(blob => blob.pathname.startsWith('screenshots/')).length
            }
        });
    } catch (error) {
        console.error('Error listing users:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve users',
            error: error.message
        });
    }
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

    try {
        // Get all blobs from storage
        const { blobs } = await list();
        
        // Filter blobs for this specific user
        const userBlobs = blobs.filter(blob => 
            blob.pathname.startsWith(`screenshots/${userId}/`)
        );

        // Sort by upload time (most recent first)
        userBlobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

        // Format the response
        const screenshots = userBlobs.map(blob => {
            const fileName = blob.pathname.split('/').pop();
            const screenshotId = fileName.replace('.png', '');
            
            return {
                id: screenshotId,
                filename: blob.pathname,
                uploadedAt: blob.uploadedAt,
                size: blob.size,
                blobUrl: blob.url,
                timestamp: new Date(blob.uploadedAt).getTime()
            };
        });

        // Check if user exists in memory or create basic info
        let userData = clipboardIndex.users[userId] || {
            username: userId, // fallback to userId if no username stored
            deviceInfo: {},
            screenshots: [],
            firstSeen: userBlobs.length > 0 ? userBlobs[userBlobs.length - 1].uploadedAt : new Date().toISOString(),
            lastActive: userBlobs.length > 0 ? userBlobs[0].uploadedAt : new Date().toISOString(),
            totalScreenshots: userBlobs.length
        };

        return res.status(200).json({
            success: true,
            message: 'User screenshots retrieved successfully',
            data: {
                userId: userId,
                username: userData.username,
                deviceInfo: userData.deviceInfo,
                screenshots: screenshots,
                totalScreenshots: screenshots.length
            }
        });
    } catch (error) {
        console.error('Error fetching user screenshots:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve user screenshots',
            error: error.message
        });
    }
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

    if (!clipboardIndex.users[userId]) {
        return res.status(404).json({
            success: false,
            message: 'User not found'
        });
    }

    const screenshot = clipboardIndex.users[userId].screenshots.find(s => s.id === screenshotId);
    
    if (!screenshot) {
        return res.status(404).json({
            success: false,
            message: 'Screenshot not found'
        });
    }

    // Redirect to the Blob URL (images are publicly accessible)
    return res.redirect(302, screenshot.blobUrl);
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
        if (!clipboardIndex.users[userId]) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const screenshotIndex = clipboardIndex.users[userId].screenshots.findIndex(s => s.id === screenshotId);
        
        if (screenshotIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Screenshot not found'
            });
        }

        const screenshot = clipboardIndex.users[userId].screenshots[screenshotIndex];
        
        // Delete from Blob storage
        try {
            await del(screenshot.blobUrl);
        } catch (error) {
            console.log(`Could not delete screenshot file from Blob: ${screenshot.filename}`);
        }

        // Remove from index
        clipboardIndex.users[userId].screenshots.splice(screenshotIndex, 1);
        clipboardIndex.totalScreenshots--;
        clipboardIndex.lastUpdated = new Date().toISOString();

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
        if (!clipboardIndex.users[userId]) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const screenshots = clipboardIndex.users[userId].screenshots;
        
        // Delete all screenshot files from Blob for this user
        for (const screenshot of screenshots) {
            try {
                await del(screenshot.blobUrl);
            } catch (error) {
                console.log(`Could not delete screenshot file from Blob: ${screenshot.filename}`);
            }
        }

        // Update index
        clipboardIndex.totalScreenshots -= screenshots.length;
        clipboardIndex.users[userId].screenshots = [];
        clipboardIndex.lastUpdated = new Date().toISOString();

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

    const stats = {
        totalUsers: Object.keys(clipboardIndex.users).length,
        totalScreenshots: clipboardIndex.totalScreenshots,
        lastUpdated: clipboardIndex.lastUpdated,
        userStats: Object.entries(clipboardIndex.users).map(([userId, userData]) => ({
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

// Simple health check
async function handleHealthCheck(req, res) {
    return res.status(200).json({
        success: true,
        message: 'Clipboard API is healthy',
        timestamp: new Date().toISOString(),
        totalUsers: Object.keys(clipboardIndex.users).length,
        totalScreenshots: clipboardIndex.totalScreenshots
    });
}
