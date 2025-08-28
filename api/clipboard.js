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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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

// Sync in-memory data with blob storage (helper function)
async function syncUserDataFromBlobs() {
    try {
        const { blobs } = await list();
        
        // Extract unique user IDs from blob paths
        const userIds = [...new Set(
            blobs
                .filter(blob => blob.pathname.startsWith('screenshots/'))
                .map(blob => blob.pathname.split('/')[1])
                .filter(userId => userId && userId !== '')
        )];

        // Sync each user's data
        for (const userId of userIds) {
            const userBlobs = blobs.filter(blob => 
                blob.pathname.startsWith(`screenshots/${userId}/`)
            );

            // If user doesn't exist in memory, create them
            if (!clipboardIndex.users[userId]) {
                clipboardIndex.users[userId] = {
                    username: userId, // fallback
                    deviceInfo: {},
                    screenshots: [],
                    firstSeen: userBlobs.length > 0 ? userBlobs[userBlobs.length - 1].uploadedAt : new Date().toISOString(),
                    lastActive: userBlobs.length > 0 ? userBlobs[0].uploadedAt : new Date().toISOString(),
                    totalScreenshots: userBlobs.length
                };
            }

            // Sync screenshots from blobs to memory
            clipboardIndex.users[userId].screenshots = userBlobs
                .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
                .map(blob => {
                    const fileName = blob.pathname.split('/').pop();
                    const screenshotId = fileName.replace('.png', '');
                    
                    return {
                        id: screenshotId,
                        filename: blob.pathname,
                        timestamp: new Date(blob.uploadedAt).getTime(),
                        uploadedAt: blob.uploadedAt,
                        accessType: 'Unknown', // Default since we don't have this info from blob
                        sessionInfo: {},
                        size: blob.size,
                        blobUrl: blob.url
                    };
                });

            clipboardIndex.users[userId].totalScreenshots = userBlobs.length;
        }

        clipboardIndex.totalScreenshots = blobs.filter(blob => blob.pathname.startsWith('screenshots/')).length;
        clipboardIndex.lastUpdated = new Date().toISOString();

    } catch (error) {
        console.error('Error syncing user data from blobs:', error);
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
        // Sync data from blob storage first
        await syncUserDataFromBlobs();

        const userList = Object.entries(clipboardIndex.users).map(([userId, userData]) => ({
            userId: userId,
            username: userData.username,
            deviceInfo: userData.deviceInfo,
            totalScreenshots: userData.screenshots.length,
            firstSeen: userData.firstSeen,
            lastActive: userData.lastActive,
            latestScreenshot: userData.screenshots.length > 0 ? 
                userData.screenshots[0].uploadedAt : null
        }));

        return res.status(200).json({
            success: true,
            message: 'Users retrieved successfully',
            data: {
                users: userList,
                totalUsers: userList.length,
                totalScreenshots: clipboardIndex.totalScreenshots
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
        // Sync data from blob storage first
        await syncUserDataFromBlobs();

        // Check if user exists after sync
        if (!clipboardIndex.users[userId]) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const userData = clipboardIndex.users[userId];

        return res.status(200).json({
            success: true,
            message: 'User screenshots retrieved successfully',
            data: {
                userId: userId,
                username: userData.username,
                deviceInfo: userData.deviceInfo,
                screenshots: userData.screenshots,
                totalScreenshots: userData.screenshots.length
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

    try {
        // Sync data first
        await syncUserDataFromBlobs();

        // Check if user exists
        if (!clipboardIndex.users[userId]) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Find the screenshot in the user's screenshots
        const screenshot = clipboardIndex.users[userId].screenshots.find(s => s.id === screenshotId);
        
        if (!screenshot) {
            return res.status(404).json({
                success: false,
                message: 'Screenshot not found'
            });
        }

        // Fetch the image data from the blob URL
        const imageResponse = await fetch(screenshot.blobUrl);
        if (!imageResponse.ok) {
            return res.status(404).json({
                success: false,
                message: 'Screenshot file not accessible'
            });
        }

        const imageBuffer = await imageResponse.arrayBuffer();
        
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Length', imageBuffer.byteLength);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        
        return res.status(200).send(Buffer.from(imageBuffer));
        
    } catch (error) {
        console.error('Error fetching screenshot:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve screenshot',
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

    const { screenshotId, userId } = req.method === 'DELETE' ? req.query : req.body;
    if (!screenshotId || !userId) {
        return res.status(400).json({
            success: false,
            message: 'screenshotId and userId required'
        });
    }

    try {
        // Sync data first
        await syncUserDataFromBlobs();

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
            // Continue anyway to clean up memory
        }

        // Remove from index
        clipboardIndex.users[userId].screenshots.splice(screenshotIndex, 1);
        clipboardIndex.users[userId].totalScreenshots--;
        clipboardIndex.totalScreenshots--;
        clipboardIndex.lastUpdated = new Date().toISOString();

        return res.status(200).json({
            success: true,
            message: 'Screenshot deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting screenshot:', error);
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
        // Sync data first
        await syncUserDataFromBlobs();

        if (!clipboardIndex.users[userId]) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const screenshots = clipboardIndex.users[userId].screenshots;
        const screenshotCount = screenshots.length;
        
        // Delete all screenshot files from Blob for this user
        for (const screenshot of screenshots) {
            try {
                await del(screenshot.blobUrl);
            } catch (error) {
                console.log(`Could not delete screenshot file from Blob: ${screenshot.filename}`);
            }
        }

        // Update index
        clipboardIndex.totalScreenshots -= screenshotCount;
        clipboardIndex.users[userId].screenshots = [];
        clipboardIndex.users[userId].totalScreenshots = 0;
        clipboardIndex.lastUpdated = new Date().toISOString();

        return res.status(200).json({
            success: true,
            message: `Cleared ${screenshotCount} screenshots for user ${userId}`
        });

    } catch (error) {
        console.error('Error clearing user clipboard:', error);
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

    try {
        // Sync data first
        await syncUserDataFromBlobs();

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
    } catch (error) {
        console.error('Error getting stats:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve statistics',
            error: error.message
        });
    }
}

// Simple health check
async function handleHealthCheck(req, res) {
    try {
        // Quick sync for health check
        await syncUserDataFromBlobs();
        
        return res.status(200).json({
            success: true,
            message: 'Clipboard API is healthy',
            timestamp: new Date().toISOString(),
            totalUsers: Object.keys(clipboardIndex.users).length,
            totalScreenshots: clipboardIndex.totalScreenshots
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Health check failed',
            error: error.message
        });
    }
}
