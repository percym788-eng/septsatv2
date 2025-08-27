// api/clipboard.js - Screenshot Clipboard Management API with Vercel Blob Only
import { put, del } from '@vercel/blob';

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
            case 'health':
                return await handleHealthCheck(req, res);
            default:
                return res.status(400).json({
                    success: false,
                    message: 'Invalid action. Available: upload-screenshot, health'
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

// Generate unique screenshot ID
function generateScreenshotId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// Handle screenshot upload (no admin key required - devices upload automatically)
async function handleScreenshotUpload(req, res) {
    const { 
        userId, 
        username, 
        imageData
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

// Simple health check
async function handleHealthCheck(req, res) {
    return res.status(200).json({
        success: true,
        message: 'Clipboard API is healthy',
        timestamp: new Date().toISOString()
    });
}
