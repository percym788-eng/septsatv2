// api/clipboard.js - Enhanced Screenshot Clipboard Management API with AI-Powered OCR Processing
import { put, del, list } from '@vercel/blob';

// Hardcoded admin key for clipboard access
const HARDCODED_ADMIN_KEY = "122316";

// Validate admin access for clipboard viewing
function validateClipboardAccess(req) {
    const adminKey = req.headers['x-admin-key'] || req.body?.adminKey;
    return adminKey === HARDCODED_ADMIN_KEY;
}

// Generate unique screenshot/OCR ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// In-memory storage for clipboard index with OCR data
let clipboardIndex = {
    users: {},
    totalScreenshots: 0,
    totalOcrEntries: 0,
    lastUpdated: null
};

// AI-powered text cleaning function
async function cleanOcrTextWithAI(rawText) {
    try {
        // Check if the text appears to contain a question/quiz content
        const hasQuestionIndicators = /question\s*\d+|multiple\s*choice|answer|choice|select|which|what|how|why|when|where/i.test(rawText);
        
        if (!hasQuestionIndicators) {
            return {
                isQuestion: false,
                cleanedText: rawText,
                questionNumber: null,
                questionText: null,
                answerChoices: [],
                correctAnswer: null,
                confidence: 0
            };
        }

        // Use a simple AI-like processing approach to extract question components
        const cleaned = await processQuestionText(rawText);
        return cleaned;
        
    } catch (error) {
        console.error('AI text cleaning error:', error);
        return {
            isQuestion: false,
            cleanedText: rawText,
            questionNumber: null,
            questionText: null,
            answerChoices: [],
            correctAnswer: null,
            confidence: 0,
            error: error.message
        };
    }
}

// Process and clean question text
async function processQuestionText(rawText) {
    // Remove common browser/UI elements
    let cleanText = rawText
        .replace(/Chrome File Edit View History Bookmarks.*?(\n|$)/gi, '')
        .replace(/https?:\/\/[^\s]+/g, '')
        .replace(/\d+\s*x\s*\d+/g, '')
        .replace(/[©®™]/g, '')
        .replace(/\s*Incognito\s*/g, '')
        .replace(/Help\s*\d*\s*Choice\s*Questions/gi, '')
        .replace(/blackboard\.com[^\s]*/gi, '')
        .replace(/[A-Z0-9]{8,}/g, '') // Remove long alphanumeric codes
        .replace(/\s+/g, ' ')
        .trim();

    // Extract question number
    const questionNumberMatch = cleanText.match(/Question\s*(\d+)/i);
    const questionNumber = questionNumberMatch ? parseInt(questionNumberMatch[1]) : null;

    // Extract main question text
    let questionText = cleanText;
    if (questionNumberMatch) {
        questionText = cleanText.substring(questionNumberMatch.index + questionNumberMatch[0].length).trim();
    }

    // Remove everything after "describes:" or similar endings
    questionText = questionText.replace(/describes:.*$/i, 'describes:');
    
    // Extract answer choices (A), (B), (C), (D) pattern
    const answerChoices = [];
    const choicePattern = /\([A-E]\)\s*([^(]*?)(?=\([A-E]\)|$)/gi;
    let match;
    
    while ((match = choicePattern.exec(cleanText)) !== null) {
        const choice = match[0].trim();
        const letter = choice.match(/\(([A-E])\)/)[1];
        const text = choice.replace(/\([A-E]\)\s*/, '').trim();
        
        if (text) {
            answerChoices.push({
                letter: letter,
                text: text,
                fullChoice: choice
            });
        }
    }

    // Remove answer choices from question text
    if (answerChoices.length > 0) {
        questionText = questionText.replace(choicePattern, '').trim();
    }

    // Clean up question text further
    questionText = questionText
        .replace(/^.*?The examination/, 'The examination') // Start from actual question
        .replace(/anthropology\s*sociology.*$/i, '') // Remove trailing fragments
        .trim();

    // Determine confidence based on how well we parsed it
    let confidence = 0;
    if (questionNumber) confidence += 0.3;
    if (questionText.length > 10) confidence += 0.4;
    if (answerChoices.length >= 2) confidence += 0.3;

    return {
        isQuestion: confidence > 0.5,
        cleanedText: questionText,
        questionNumber: questionNumber,
        questionText: questionText,
        answerChoices: answerChoices,
        correctAnswer: null, // Would need additional logic to detect correct answer
        confidence: confidence,
        originalLength: rawText.length,
        cleanedLength: questionText.length
    };
}

// Enhanced OCR upload handler with AI processing
async function handleOcrUpload(req, res) {
    const ocrData = req.body;

    if (!ocrData || !ocrData.metadata || !ocrData.ocr) {
        return res.status(400).json({
            success: false,
            message: 'Invalid OCR data structure. Expected metadata and ocr fields.'
        });
    }

    try {
        const { metadata, ocr, stats } = ocrData;
        const userId = metadata.user || metadata.deviceId || 'unknown';
        const ocrId = generateId();
        
        console.log(`Processing OCR data from user ${userId}`);
        console.log(`Text length: ${ocr.text?.length || 0}, Method: ${ocr.method}, Confidence: ${ocr.confidence}`);

        // Process the OCR text with AI cleaning
        const aiProcessed = await cleanOcrTextWithAI(ocr.text || '');
        
        // Enhanced OCR data structure
        const enhancedOcrData = {
            ...ocrData,
            aiProcessing: aiProcessed,
            processedAt: new Date().toISOString()
        };

        // Store enhanced OCR JSON data in Blob
        const fileName = `ocr/${userId}/${ocrId}.json`;
        const blob = await put(fileName, JSON.stringify(enhancedOcrData, null, 2), {
            access: 'public',
            contentType: 'application/json',
        });

        // Update in-memory clipboard index
        if (!clipboardIndex.users[userId]) {
            clipboardIndex.users[userId] = {
                username: metadata.user || userId,
                deviceInfo: {
                    hostname: metadata.hostname || 'Unknown',
                    platform: metadata.platform || 'Unknown',
                    deviceId: metadata.deviceId || 'Unknown',
                    accessType: metadata.accessType || 'Unknown'
                },
                screenshots: [],
                ocrEntries: [],
                firstSeen: new Date().toISOString(),
                lastActive: new Date().toISOString(),
                totalScreenshots: 0,
                totalOcrEntries: 0
            };
        }

        // Add OCR entry to user's data
        const ocrEntry = {
            id: ocrId,
            filename: fileName,
            timestamp: metadata.timestamp || Date.now(),
            uploadedAt: new Date().toISOString(),
            screenshotPath: metadata.screenshotPath,
            screenshotFileName: metadata.screenshotFileName,
            extractedText: ocr.text || '',
            textConfidence: ocr.confidence || 0,
            wordCount: ocr.wordCount || 0,
            characterCount: ocr.characterCount || 0,
            hasText: ocr.hasText || false,
            method: ocr.method || 'unknown',
            sessionStats: stats || {},
            blobUrl: blob.url,
            size: JSON.stringify(enhancedOcrData).length,
            // AI processing results
            aiProcessed: aiProcessed,
            isQuestion: aiProcessed.isQuestion,
            questionNumber: aiProcessed.questionNumber,
            cleanedText: aiProcessed.cleanedText,
            answerChoices: aiProcessed.answerChoices,
            aiConfidence: aiProcessed.confidence
        };

        clipboardIndex.users[userId].ocrEntries.unshift(ocrEntry); // Add to beginning
        clipboardIndex.users[userId].lastActive = new Date().toISOString();
        clipboardIndex.users[userId].totalOcrEntries++;

        // Keep only last 100 OCR entries per user
        if (clipboardIndex.users[userId].ocrEntries.length > 100) {
            const oldEntries = clipboardIndex.users[userId].ocrEntries.splice(100);
            
            // Delete old files from Blob
            for (const oldEntry of oldEntries) {
                try {
                    await del(oldEntry.blobUrl);
                } catch (error) {
                    console.log(`Could not delete old OCR file: ${oldEntry.filename}`);
                }
            }
        }

        clipboardIndex.totalOcrEntries++;
        clipboardIndex.lastUpdated = new Date().toISOString();

        console.log(`OCR data processed successfully: ${ocrId} for user ${userId}`);
        console.log(`AI Processing: isQuestion=${aiProcessed.isQuestion}, confidence=${aiProcessed.confidence}`);

        return res.status(200).json({
            success: true,
            message: 'OCR data uploaded and processed successfully',
            data: {
                ocrId: ocrId,
                userId: userId,
                blobUrl: blob.url,
                extractedText: ocr.text,
                wordCount: ocr.wordCount,
                hasText: ocr.hasText,
                method: ocr.method,
                confidence: ocr.confidence,
                aiProcessing: {
                    isQuestion: aiProcessed.isQuestion,
                    questionNumber: aiProcessed.questionNumber,
                    cleanedText: aiProcessed.cleanedText,
                    answerChoicesCount: aiProcessed.answerChoices.length,
                    confidence: aiProcessed.confidence
                }
            }
        });

    } catch (error) {
        console.error('OCR upload error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to upload OCR data',
            error: error.message
        });
    }
}

// Generate formatted question export
async function handleExportQuestions(req, res) {
    if (!validateClipboardAccess(req)) {
        return res.status(403).json({
            success: false,
            message: 'Clipboard access denied. Correct admin key required.'
        });
    }

    const { userId, format = 'json' } = req.query;
    
    try {
        await syncDataFromBlobs();
        
        let questionsData = [];
        const usersToExport = userId ? [userId] : Object.keys(clipboardIndex.users);

        for (const uId of usersToExport) {
            if (!clipboardIndex.users[uId]) continue;

            const userQuestions = clipboardIndex.users[uId].ocrEntries
                .filter(entry => entry.isQuestion && entry.aiConfidence > 0.5)
                .map(entry => ({
                    id: entry.id,
                    userId: uId,
                    username: clipboardIndex.users[uId].username,
                    questionNumber: entry.questionNumber,
                    questionText: entry.cleanedText,
                    answerChoices: entry.answerChoices,
                    uploadedAt: entry.uploadedAt,
                    confidence: entry.aiConfidence,
                    originalText: entry.extractedText
                }));

            questionsData.push(...userQuestions);
        }

        // Sort by question number and upload time
        questionsData.sort((a, b) => {
            if (a.questionNumber && b.questionNumber) {
                return a.questionNumber - b.questionNumber;
            }
            return new Date(b.uploadedAt) - new Date(a.uploadedAt);
        });

        if (format === 'html') {
            const html = generateQuestionsHTML(questionsData);
            res.setHeader('Content-Type', 'text/html');
            return res.status(200).send(html);
        } else {
            return res.status(200).json({
                success: true,
                message: `Exported ${questionsData.length} questions`,
                data: {
                    questions: questionsData,
                    totalQuestions: questionsData.length,
                    exportedAt: new Date().toISOString(),
                    format: format
                }
            });
        }

    } catch (error) {
        console.error('Export error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to export questions',
            error: error.message
        });
    }
}

// Generate HTML for questions export
function generateQuestionsHTML(questions) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SAT Helper - Extracted Questions</title>
    <style>
        body {
            font-family: 'Times New Roman', serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            line-height: 1.6;
            background: #fff;
            color: #333;
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
            border-bottom: 2px solid #333;
            padding-bottom: 20px;
        }
        .question-block {
            margin-bottom: 30px;
            padding: 20px;
            border: 1px solid #ddd;
            border-radius: 8px;
            background: #fafafa;
        }
        .question-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid #eee;
        }
        .question-number {
            font-weight: bold;
            font-size: 1.2em;
            color: #2c5aa0;
        }
        .confidence-badge {
            background: #4CAF50;
            color: white;
            padding: 3px 8px;
            border-radius: 12px;
            font-size: 0.8em;
        }
        .question-text {
            font-size: 1.1em;
            margin-bottom: 20px;
            line-height: 1.7;
        }
        .answer-choices {
            margin-left: 20px;
        }
        .choice {
            margin-bottom: 8px;
            display: flex;
            align-items: flex-start;
        }
        .choice-letter {
            font-weight: bold;
            margin-right: 10px;
            min-width: 25px;
        }
        .metadata {
            font-size: 0.8em;
            color: #666;
            margin-top: 15px;
            padding-top: 10px;
            border-top: 1px solid #eee;
        }
        .print-button {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 10px 20px;
            background: #2c5aa0;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
        }
        @media print {
            .print-button { display: none; }
            .question-block { break-inside: avoid; }
        }
    </style>
</head>
<body>
    <button class="print-button" onclick="window.print()">Print PDF</button>
    
    <div class="header">
        <h1>SAT Helper - Extracted Questions</h1>
        <p>Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
        <p>Total Questions: ${questions.length}</p>
    </div>

    ${questions.map(q => `
        <div class="question-block">
            <div class="question-header">
                <div class="question-number">
                    ${q.questionNumber ? `Question ${q.questionNumber}` : 'Extracted Question'}
                </div>
                <div class="confidence-badge">${Math.round(q.confidence * 100)}% confidence</div>
            </div>
            
            <div class="question-text">${q.questionText}</div>
            
            ${q.answerChoices.length > 0 ? `
                <div class="answer-choices">
                    ${q.answerChoices.map(choice => `
                        <div class="choice">
                            <div class="choice-letter">(${choice.letter})</div>
                            <div>${choice.text}</div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            
            <div class="metadata">
                <div><strong>User:</strong> ${q.username}</div>
                <div><strong>Captured:</strong> ${new Date(q.uploadedAt).toLocaleString()}</div>
                <div><strong>Processing Confidence:</strong> ${Math.round(q.confidence * 100)}%</div>
            </div>
        </div>
    `).join('')}
    
    ${questions.length === 0 ? '<div class="question-block"><p>No questions found with sufficient confidence level.</p></div>' : ''}
</body>
</html>`;
}

// Update the main handler to include export functionality
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
            case 'upload-ocr':
                return await handleOcrUpload(req, res);
            case 'export-questions':
                return await handleExportQuestions(req, res);
            case 'list-users':
                return await handleListUsers(req, res);
            case 'get-user-screenshots':
                return await handleGetUserScreenshots(req, res);
            case 'get-user-ocr':
                return await handleGetUserOcr(req, res);
            case 'get-screenshot':
                return await handleGetScreenshot(req, res);
            case 'search-text':
                return await handleSearchText(req, res);
            case 'delete-screenshot':
                return await handleDeleteScreenshot(req, res);
            case 'delete-ocr':
                return await handleDeleteOcr(req, res);
            case 'clear-user-clipboard':
                return await handleClearUserClipboard(req, res);
            case 'get-stats':
                return await handleGetStats(req, res);
            case 'health':
                return await handleHealthCheck(req, res);
            default:
                return res.status(400).json({
                    success: false,
                    message: 'Invalid action. Available: upload-screenshot, upload-ocr, export-questions, list-users, get-user-screenshots, get-user-ocr, get-screenshot, search-text, delete-screenshot, delete-ocr, clear-user-clipboard, get-stats, health'
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

// Include all other existing functions (handleScreenshotUpload, syncDataFromBlobs, etc.)
// ... [Rest of the original functions remain unchanged] ...

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
        const screenshotId = generateId();
        
        // Convert base64 to buffer
        const imageBuffer = Buffer.from(imageData, 'base64');
        
        console.log(`Processing screenshot ${screenshotId} for user ${userId}`);
        
        // Upload image to Vercel Blob
        const fileName = `screenshots/${userId}/${screenshotId}.png`;
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
                ocrEntries: [],
                firstSeen: new Date().toISOString(),
                lastActive: new Date().toISOString(),
                totalScreenshots: 0,
                totalOcrEntries: 0
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

        clipboardIndex.users[userId].screenshots.unshift(screenshotEntry);
        clipboardIndex.users[userId].lastActive = new Date().toISOString();
        clipboardIndex.users[userId].totalScreenshots++;
        
        // Keep only last 50 screenshots per user
        if (clipboardIndex.users[userId].screenshots.length > 50) {
            const oldScreenshots = clipboardIndex.users[userId].screenshots.splice(50);
            
            // Delete old files from Blob
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

        console.log(`Screenshot processed successfully: ${screenshotId}`);

        return res.status(200).json({
            success: true,
            message: 'Screenshot uploaded successfully',
            data: {
                screenshotId: screenshotId,
                userId: userId,
                blobUrl: blob.url
            }
        });

    } catch (error) {
        console.error('Screenshot upload error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to upload screenshot',
            error: error.message
        });
    }
}

// Sync in-memory data with blob storage
async function syncDataFromBlobs() {
    try {
        const { blobs } = await list();
        
        // Extract unique user IDs from blob paths
        const userIds = [...new Set(
            blobs
                .filter(blob => blob.pathname.startsWith('screenshots/') || blob.pathname.startsWith('ocr/'))
                .map(blob => blob.pathname.split('/')[1])
                .filter(userId => userId && userId !== '')
        )];

        // Sync each user's data
        for (const userId of userIds) {
            const userScreenshotBlobs = blobs.filter(blob => 
                blob.pathname.startsWith(`screenshots/${userId}/`)
            );
            
            const userOcrBlobs = blobs.filter(blob => 
                blob.pathname.startsWith(`ocr/${userId}/`)
            );

            // If user doesn't exist in memory, create them
            if (!clipboardIndex.users[userId]) {
                clipboardIndex.users[userId] = {
                    username: userId,
                    deviceInfo: {},
                    screenshots: [],
                    ocrEntries: [],
                    firstSeen: new Date().toISOString(),
                    lastActive: new Date().toISOString(),
                    totalScreenshots: userScreenshotBlobs.length,
                    totalOcrEntries: userOcrBlobs.length
                };
            }

            // Sync screenshots
            clipboardIndex.users[userId].screenshots = userScreenshotBlobs
                .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
                .map((blob) => {
                    const fileName = blob.pathname.split('/').pop();
                    const screenshotId = fileName.replace('.png', '');
                    
                    return {
                        id: screenshotId,
                        filename: blob.pathname,
                        timestamp: new Date(blob.uploadedAt).getTime(),
                        uploadedAt: blob.uploadedAt,
                        accessType: 'Unknown',
                        sessionInfo: {},
                        size: blob.size,
                        blobUrl: blob.url
                    };
                });

            // Sync OCR entries
            clipboardIndex.users[userId].ocrEntries = await Promise.all(
                userOcrBlobs
                    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
                    .map(async (blob) => {
                        const fileName = blob.pathname.split('/').pop();
                        const ocrId = fileName.replace('.json', '');
                        
                        // Try to fetch OCR data for text preview
                        let ocrPreview = {};
                        try {
                            const response = await fetch(blob.url);
                            if (response.ok) {
                                const ocrData = await response.json();
                                ocrPreview = {
                                    extractedText: ocrData.ocr?.text || '',
                                    wordCount: ocrData.ocr?.wordCount || 0,
                                    hasText: ocrData.ocr?.hasText || false,
                                    method: ocrData.ocr?.method || 'unknown',
                                    confidence: ocrData.ocr?.confidence || 0
                                };
                            }
                        } catch (e) {
                            console.log(`Could not fetch OCR data for ${ocrId}`);
                        }
                        
                        return {
                            id: ocrId,
                            filename: blob.pathname,
                            timestamp: new Date(blob.uploadedAt).getTime(),
                            uploadedAt: blob.uploadedAt,
                            size: blob.size,
                            blobUrl: blob.url,
                            ...ocrPreview
                        };
                    })
            );

            clipboardIndex.users[userId].totalScreenshots = userScreenshotBlobs.length;
            clipboardIndex.users[userId].totalOcrEntries = userOcrBlobs.length;
        }

        clipboardIndex.totalScreenshots = blobs.filter(blob => blob.pathname.startsWith('screenshots/')).length;
        clipboardIndex.totalOcrEntries = blobs.filter(blob => blob.pathname.startsWith('ocr/')).length;
        clipboardIndex.lastUpdated = new Date().toISOString();

    } catch (error) {
        console.error('Error syncing data from blobs:', error);
    }
}

// Get screenshot file
async function handleGetScreenshot(req, res) {
    const { screenshotId, userId } = req.query;
    
    if (!screenshotId || !userId) {
        return res.status(400).json({
            success: false,
            message: 'screenshotId and userId parameters required'
        });
    }

    try {
        await syncDataFromBlobs();

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

        // Redirect to the blob URL
        return res.redirect(screenshot.blobUrl);
    } catch (error) {
        console.error('Error fetching screenshot:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve screenshot',
            error: error.message
        });
    }
}

// Get user OCR entries
async function handleGetUserOcr(req, res) {
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
        await syncDataFromBlobs();

        if (!clipboardIndex.users[userId]) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const userData = clipboardIndex.users[userId];

        return res.status(200).json({
            success: true,
            message: 'User OCR data retrieved successfully',
            data: {
                userId: userId,
                username: userData.username,
                deviceInfo: userData.deviceInfo,
                ocrEntries: userData.ocrEntries.map(entry => ({
                    ...entry,
                    textPreview: entry.extractedText ? 
                        entry.extractedText.substring(0, 200) + 
                        (entry.extractedText.length > 200 ? '...' : '') : null
                })),
                totalOcrEntries: userData.ocrEntries.length
            }
        });
    } catch (error) {
        console.error('Error fetching user OCR data:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve user OCR data',
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
        await syncDataFromBlobs();

        let searchResults = [];
        const searchTerm = searchQuery.toLowerCase();

        // Search in specific user or all users
        const usersToSearch = userId ? [userId] : Object.keys(clipboardIndex.users);

        for (const uId of usersToSearch) {
            if (!clipboardIndex.users[uId]) continue;

            const userOcrEntries = clipboardIndex.users[uId].ocrEntries.filter(entry => {
                return entry.extractedText && 
                       entry.extractedText.toLowerCase().includes(searchTerm);
            });

            searchResults.push(...userOcrEntries.map(entry => ({
                ...entry,
                userId: uId,
                username: clipboardIndex.users[uId].username,
                matchHighlight: getTextHighlight(entry.extractedText, searchTerm),
                matchCount: (entry.extractedText.toLowerCase().match(new RegExp(searchTerm, 'g')) || []).length
            })));
        }

        // Sort by relevance (more matches = higher relevance)
        searchResults.sort((a, b) => b.matchCount - a.matchCount);

        return res.status(200).json({
            success: true,
            message: `Found ${searchResults.length} OCR entries containing "${searchQuery}"`,
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
function getTextHighlight(text, searchTerm, contextLength = 150) {
    if (!text || !searchTerm) return '';
    
    const index = text.toLowerCase().indexOf(searchTerm.toLowerCase());
    if (index === -1) return text.substring(0, contextLength);
    
    const start = Math.max(0, index - contextLength / 2);
    const end = Math.min(text.length, index + searchTerm.length + contextLength / 2);
    
    return text.substring(start, end);
}

// List users with enhanced stats
async function handleListUsers(req, res) {
    if (!validateClipboardAccess(req)) {
        return res.status(403).json({
            success: false,
            message: 'Clipboard access denied. Correct admin key required.'
        });
    }

    try {
        await syncDataFromBlobs();

        const userList = Object.entries(clipboardIndex.users).map(([userId, userData]) => ({
            userId: userId,
            username: userData.username,
            deviceInfo: userData.deviceInfo,
            totalScreenshots: userData.screenshots.length,
            totalOcrEntries: userData.ocrEntries.length,
            firstSeen: userData.firstSeen,
            lastActive: userData.lastActive,
            latestScreenshot: userData.screenshots.length > 0 ? userData.screenshots[0].uploadedAt : null,
            latestOcrEntry: userData.ocrEntries.length > 0 ? userData.ocrEntries[0].uploadedAt : null
        }));

        return res.status(200).json({
            success: true,
            message: 'Users retrieved successfully',
            data: {
                users: userList,
                totalUsers: userList.length,
                totalScreenshots: clipboardIndex.totalScreenshots,
                totalOcrEntries: clipboardIndex.totalOcrEntries
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

// Get user screenshots
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
        await syncDataFromBlobs();

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

// Delete specific screenshot
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
        await syncDataFromBlobs();

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
            console.log(`Could not delete screenshot: ${screenshot.filename}`);
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

// Delete specific OCR entry
async function handleDeleteOcr(req, res) {
    if (!validateClipboardAccess(req)) {
        return res.status(403).json({
            success: false,
            message: 'Clipboard access denied. Correct admin key required.'
        });
    }

    const { ocrId, userId } = req.method === 'DELETE' ? req.query : req.body;
    if (!ocrId || !userId) {
        return res.status(400).json({
            success: false,
            message: 'ocrId and userId required'
        });
    }

    try {
        await syncDataFromBlobs();

        if (!clipboardIndex.users[userId]) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const ocrIndex = clipboardIndex.users[userId].ocrEntries.findIndex(o => o.id === ocrId);
        
        if (ocrIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'OCR entry not found'
            });
        }

        const ocrEntry = clipboardIndex.users[userId].ocrEntries[ocrIndex];
        
        // Delete from Blob storage
        try {
            await del(ocrEntry.blobUrl);
        } catch (error) {
            console.log(`Could not delete OCR entry: ${ocrEntry.filename}`);
        }

        // Remove from index
        clipboardIndex.users[userId].ocrEntries.splice(ocrIndex, 1);
        clipboardIndex.users[userId].totalOcrEntries--;
        clipboardIndex.totalOcrEntries--;
        clipboardIndex.lastUpdated = new Date().toISOString();

        return res.status(200).json({
            success: true,
            message: 'OCR entry deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting OCR entry:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to delete OCR entry',
            error: error.message
        });
    }
}

// Clear all data for a user
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
        await syncDataFromBlobs();

        if (!clipboardIndex.users[userId]) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const screenshots = clipboardIndex.users[userId].screenshots;
        const ocrEntries = clipboardIndex.users[userId].ocrEntries;
        
        // Delete all files from Blob for this user
        for (const screenshot of screenshots) {
            try {
                await del(screenshot.blobUrl);
            } catch (error) {
                console.log(`Could not delete screenshot: ${screenshot.filename}`);
            }
        }
        
        for (const ocrEntry of ocrEntries) {
            try {
                await del(ocrEntry.blobUrl);
            } catch (error) {
                console.log(`Could not delete OCR entry: ${ocrEntry.filename}`);
            }
        }

        // Update counters
        clipboardIndex.totalScreenshots -= screenshots.length;
        clipboardIndex.totalOcrEntries -= ocrEntries.length;
        clipboardIndex.users[userId].screenshots = [];
        clipboardIndex.users[userId].ocrEntries = [];
        clipboardIndex.users[userId].totalScreenshots = 0;
        clipboardIndex.users[userId].totalOcrEntries = 0;
        clipboardIndex.lastUpdated = new Date().toISOString();

        return res.status(200).json({
            success: true,
            message: `Cleared ${screenshots.length} screenshots and ${ocrEntries.length} OCR entries for user ${userId}`
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

// Get statistics
async function handleGetStats(req, res) {
    if (!validateClipboardAccess(req)) {
        return res.status(403).json({
            success: false,
            message: 'Clipboard access denied. Correct admin key required.'
        });
    }

    try {
        await syncDataFromBlobs();

        const stats = {
            totalUsers: Object.keys(clipboardIndex.users).length,
            totalScreenshots: clipboardIndex.totalScreenshots,
            totalOcrEntries: clipboardIndex.totalOcrEntries,
            lastUpdated: clipboardIndex.lastUpdated,
            userStats: Object.entries(clipboardIndex.users).map(([userId, userData]) => ({
                userId,
                username: userData.username,
                screenshotCount: userData.screenshots.length,
                ocrCount: userData.ocrEntries.length,
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

// Health check
async function handleHealthCheck(req, res) {
    try {
        await syncDataFromBlobs();
        
        return res.status(200).json({
            success: true,
            message: 'OCR-enhanced Clipboard API is healthy',
            timestamp: new Date().toISOString(),
            totalUsers: Object.keys(clipboardIndex.users).length,
            totalScreenshots: clipboardIndex.totalScreenshots,
            totalOcrEntries: clipboardIndex.totalOcrEntries,
            features: ['screenshot-upload', 'ocr-upload', 'text-search', 'admin-management']
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Health check failed',
            error: error.message
        });
    }
}
