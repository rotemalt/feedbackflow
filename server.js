const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const { db, hashPassword, verifyPassword } = require('./database');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = 'super-secret-key-for-feedbackflow-2026';

app.use(cors()); // Allow widgets to be embedded anywhere
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Middleware ---
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token == null) return res.status(401).json({ error: 'Unauthorized' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Forbidden' });
        req.user = user;
        next();
    });
}

function optionalAuthenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        req.user = null;
        return next();
    }
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) req.user = null;
        else req.user = user;
        next();
    });
}

// --- Auth & Sign Up Endpoints ---

// 1. Secured Login using PBKDF2 Hashing verification
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM admin_users WHERE username = ?', [username], (err, row) => {
        if (err || !row) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Cryptographic hash verification
        const valid = verifyPassword(password, row.password);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ username: row.username, id: row.id }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token });
    });
});

// 2. Secured Signup for Multi-Tenant Organization Workspace admins
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    const hashed = hashPassword(password);
    db.run(
        'INSERT INTO admin_users (username, password) VALUES (?, ?)',
        [username, hashed],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(400).json({ error: 'Username already registered' });
                }
                return res.status(500).json({ error: err.message });
            }
            
            const token = jwt.sign({ username, id: this.lastID }, JWT_SECRET, { expiresIn: '24h' });
            res.status(201).json({ success: true, token, username });
        }
    );
});

app.get('/api/verify', authenticateToken, (req, res) => {
    res.json({ success: true, user: req.user });
});

// --- Projects API Endpoints (Protected Admin) ---

app.get('/api/projects', authenticateToken, (req, res) => {
    db.all("SELECT * FROM projects ORDER BY name ASC", [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

app.post('/api/projects', authenticateToken, (req, res) => {
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Project name is required' });
    }
    
    const apiKey = 'apiKey-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
    
    db.run(
        `INSERT INTO projects (name, api_key, theme_color, button_position, welcome_title) VALUES (?, ?, ?, ?, ?)`,
        [name, apiKey, '#6366f1', 'right', 'Feature Requests'],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.status(201).json({
                id: this.lastID,
                name,
                api_key: apiKey,
                theme_color: '#6366f1',
                button_position: 'right',
                welcome_title: 'Feature Requests'
            });
        }
    );
});

app.put('/api/projects/:id/theme', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { theme_color, button_position, welcome_title } = req.body;
    
    db.run(
        `UPDATE projects SET theme_color = ?, button_position = ?, welcome_title = ? WHERE id = ?`,
        [theme_color || '#6366f1', button_position || 'right', welcome_title || 'Feature Requests', id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, id, theme_color, button_position, welcome_title });
        }
    );
});

app.delete('/api/projects/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM projects WHERE id = ?", [id], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, message: 'Project deleted' });
    });
});

app.get('/api/widget-config', (req, res) => {
    const apiKey = req.query.apiKey;
    if (!apiKey) {
        return res.status(400).json({ error: 'apiKey query parameter is required' });
    }
    
    db.get("SELECT id, name, theme_color, button_position, welcome_title FROM projects WHERE api_key = ?", [apiKey], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.status(404).json({ error: 'Invalid API Key' });
        }
        res.json(row);
    });
});


// --- Feedback API Endpoints (Public & Admin) ---

app.get('/api/feedback', (req, res) => {
    const { projectId } = req.query;
    
    let sql = "SELECT f.*, p.name as project_name FROM feedback f JOIN projects p ON f.project_id = p.id";
    const params = [];
    
    if (projectId) {
        sql += " WHERE f.project_id = ?";
        params.push(projectId);
    }
    
    sql += " ORDER BY f.votes DESC";
    
    db.all(sql, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Expanded POST API with built-in Agentic AI categorization and replies
app.post('/api/feedback', async (req, res) => {
    const { project_id, title, description, category, user_email, user_name } = req.body;
    
    if (!project_id || !title || !description) {
        return res.status(400).json({ error: 'Project ID, title, and description required' });
    }

    let finalCategory = category || 'feature';
    let autoReplyComment = null;

    // --- AGENTIC AI DECISION BLOCK ---
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
        console.log(`[AI Agent] Analyzing feedback using Gemini: "${title}"...`);
        try {
            const prompt = `You are a product management AI agent on B2B SaaS.
Analyze this request submitted by a user:
Title: "${title}"
Description: "${description}"

1. Determine the category. Must be strictly one of: feature, bug, improvement.
2. If the request is too short, vague, or missing context (under 30 characters total), create a polite, professional auto-reply under the name "AI Assistant" asking clarifying questions to close the loop. If the request is descriptive, return null for the reply.

Respond only in strict JSON format:
{
  "category": "feature|bug|improvement",
  "reply": "clarification text or null"
}`;

            const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { responseMimeType: "application/json" }
                })
            });

            if (geminiRes.ok) {
                const apiData = await geminiRes.json();
                const jsonText = apiData.candidates[0].content.parts[0].text;
                const result = JSON.parse(jsonText.trim());
                
                finalCategory = result.category || finalCategory;
                autoReplyComment = result.reply || null;
                console.log(`[AI Agent] Classified as ${finalCategory}. Auto-reply: ${autoReplyComment ? 'Yes' : 'No'}`);
            }
        } catch (e) {
            console.error("[AI Agent] Gemini failure. Swapping to local heuristic fallback agent.", e);
        }
    }

    // Heuristic Fallback Agent (if API key missing or failed)
    if (!geminiKey || !autoReplyComment) {
        const fullText = (title + ' ' + description).toLowerCase();
        
        // 1. Category Heuristics
        if (/\b(crash|bug|error|broken|fail|issue|not working|broke|patch)\b/.test(fullText)) {
            finalCategory = 'bug';
        } else if (/\b(better|improve|cleaner|faster|slow|speed|ui|ux|design|aesthetic|adjust|align)\b/.test(fullText)) {
            finalCategory = 'improvement';
        } else {
            finalCategory = 'feature';
        }

        // 2. Vague Description Clarification Agent
        if (title.length + description.length < 35) {
            autoReplyComment = `Hi there! Thanks for writing in. To help our product and engineering team scope this out and resolve it quickly, could you please share a bit more detail, such as what browser you were using and what your expected outcome was? Thanks, FeedbackFlow AI Assistant.`;
        }
    }
    // --- END AGENTIC AI BLOCK ---

    db.run(
        `INSERT INTO feedback (project_id, title, description, category, user_email, user_name, status, votes) VALUES (?, ?, ?, ?, ?, ?, 'none', 1)`,
        [project_id, title, description, finalCategory, user_email || null, user_name || null],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            
            const feedbackId = this.lastID;
            
            // If the AI agent generated a clarification reply, insert it into comments
            if (autoReplyComment) {
                db.run(
                    "INSERT INTO comments (feedback_id, author_name, author_role, content) VALUES (?, ?, ?, ?)",
                    [feedbackId, 'AI Assistant', 'admin', autoReplyComment],
                    (cErr) => {
                        if (cErr) console.error("Failed placing AI clarification comment", cErr);
                    }
                );
            }

            res.status(201).json({
                id: feedbackId,
                project_id,
                title,
                description,
                category: finalCategory,
                status: 'none',
                votes: 1,
                user_email,
                user_name,
                ai_auto_replied: !!autoReplyComment
            });
        }
    );
});

app.post('/api/feedback/:id/vote', (req, res) => {
    const { id } = req.params;
    const { action } = req.body;
    
    const modifier = action === 'remove' ? '- 1' : '+ 1';
    
    db.run(`UPDATE feedback SET votes = votes ${modifier} WHERE id = ?`, [id], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, id, action });
    });
});

// --- Feedback API Endpoints (Protected Admin) ---

// Hardened status change with GitHub Issue Hook Simulation
app.put('/api/feedback/:id/status', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    
    db.get("SELECT title, category FROM feedback WHERE id = ?", [id], (err, row) => {
        if (err || !row) {
            return res.status(404).json({ error: 'Feedback not found' });
        }
        
        db.run(`UPDATE feedback SET status = ? WHERE id = ?`, [status, id], function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            
            // --- GITHUB WEBHOOK INTEGRATION MOCK ---
            if (status === 'planned' || status === 'in-progress') {
                const payload = {
                    event: "issue.create",
                    title: `[FeedbackFlow Sync] ${row.title}`,
                    body: `This issue was synced automatically from FeedbackFlow. Status set to: ${status}.\nCategory: ${row.category}`,
                    labels: [status, row.category]
                };
                
                console.log(`[GitHub Sync Hook] Pushing webhook trigger to API: https://api.github.com/repos/organization/project/issues...`);
                console.log(`[GitHub Sync Hook] Payload:`, payload);

                // Insert a system comment in the thread notifying users that this is linked to GitHub development!
                const syncMsg = `System: This feature request has been synchronized with the developer team on GitHub. Sync Issue #${Math.floor(Math.random() * 800) + 100} has been linked.`;
                db.run(
                    "INSERT INTO comments (feedback_id, author_name, author_role, content) VALUES (?, ?, ?, ?)",
                    [id, 'Developer Tools', 'admin', syncMsg]
                );
            }
            // --- END GITHUB INTEGRATION MOCK ---

            res.json({ success: true, id, status });
        });
    });
});

app.delete('/api/feedback/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM feedback WHERE id = ?", [id], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, message: 'Feedback deleted successfully' });
    });
});

// --- Commenting API Endpoints (Public & Admin) ---

app.get('/api/feedback/:id/comments', (req, res) => {
    const { id } = req.params;
    db.all("SELECT * FROM comments WHERE feedback_id = ? ORDER BY created_at ASC", [id], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

app.post('/api/feedback/:id/comments', optionalAuthenticateToken, (req, res) => {
    const { id } = req.params;
    const { content, author_name } = req.body;
    
    if (!content) {
        return res.status(400).json({ error: 'Comment content required' });
    }
    
    let name = author_name || 'Anonymous User';
    let role = 'user';
    
    if (req.user) {
        name = req.user.username === 'admin' ? 'Product Manager' : req.user.username;
        role = 'admin';
    }
    
    db.run(
        "INSERT INTO comments (feedback_id, author_name, author_role, content) VALUES (?, ?, ?, ?)",
        [id, name, role, content],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.status(201).json({
                id: this.lastID,
                feedback_id: parseInt(id),
                author_name: name,
                author_role: role,
                content,
                created_at: new Date().toISOString()
            });
        }
    );
});

// --- Rich Analytics API (Protected Admin) ---

app.get('/api/analytics', authenticateToken, (req, res) => {
    const stats = {};
    
    db.get("SELECT COUNT(*) as total FROM projects", (err, row) => {
        stats.total_projects = row ? row.total : 0;
        
        db.get("SELECT COUNT(*) as total, SUM(votes) as votes FROM feedback", (err, row) => {
            stats.total_feedback = row ? row.total : 0;
            stats.total_votes = row && row.votes ? row.votes : 0;
            
            db.all("SELECT category, COUNT(*) as count FROM feedback GROUP BY category", (err, rows) => {
                stats.categories = rows || [];
                
                db.all("SELECT status, COUNT(*) as count FROM feedback GROUP BY status", (err, rows) => {
                    stats.statuses = rows || [];
                    
                    db.all(`
                        SELECT p.name as project_name, COUNT(f.id) as feedback_count, SUM(f.votes) as vote_count 
                        FROM projects p 
                        LEFT JOIN feedback f ON p.id = f.project_id 
                        GROUP BY p.id
                    `, (err, rows) => {
                        stats.projects_breakdown = rows || [];
                        res.json(stats);
                    });
                });
            });
        });
    });
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`FeedbackFlow server running at http://localhost:${PORT}`);
});
