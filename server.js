const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const { db, hashPassword, verifyPassword } = require('./database');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-feedbackflow-2026';

app.use(cors()); // Allow widgets to be embedded anywhere
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Middleware ---

// Hardened Token Auth with DB Role/Org Verification
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token == null) return res.status(401).json({ error: 'Unauthorized' });

    jwt.verify(token, JWT_SECRET, (err, payload) => {
        if (err) return res.status(403).json({ error: 'Forbidden' });
        
        // Fetch detailed user account details from db to verify role/org status
        db.get('SELECT id, username, organization_id, role, email FROM admin_users WHERE id = ?', [payload.id], (dbErr, row) => {
            if (dbErr || !row) {
                return res.status(401).json({ error: 'Unauthorized account session' });
            }
            req.user = row;
            next();
        });
    });
}

function optionalAuthenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        req.user = null;
        return next();
    }
    jwt.verify(token, JWT_SECRET, (err, payload) => {
        if (err) {
            req.user = null;
            return next();
        }
        db.get('SELECT id, username, organization_id, role, email FROM admin_users WHERE id = ?', [payload.id], (dbErr, row) => {
            if (dbErr || !row) req.user = null;
            else req.user = row;
            next();
        });
    });
}

// Role-Based Access Control (RBAC) Route Locker
function requireRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden: Insufficient role permissions' });
        }
        next();
    };
}

// --- Auth & Multi-Tenant Organization Bootstrapping ---

// 1. Secured Login using Cryptographic pbkdf2 Hashing verification
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM admin_users WHERE username = ?', [username], (err, row) => {
        if (err || !row) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const valid = verifyPassword(password, row.password);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ username: row.username, id: row.id }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token });
    });
});

// 2. Secured Organization Multi-Tenant Signup
app.post('/api/register', (req, res) => {
    const { username, password, company_name } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    const orgName = company_name || `${username}'s Workspace`;
    
    // Create new organization
    db.run("INSERT INTO organizations (name, billing_tier) VALUES (?, ?)", [orgName, 'free'], function(oErr) {
        if (oErr) {
            return res.status(500).json({ error: oErr.message });
        }
        
        const orgId = this.lastID;
        const hashed = hashPassword(password);
        
        // Create root admin account with 'owner' role
        db.run(
            'INSERT INTO admin_users (organization_id, username, password, role, email) VALUES (?, ?, ?, ?, ?)',
            [orgId, username, hashed, 'owner', `${username}@example.com`],
            function(aErr) {
                if (aErr) {
                    if (aErr.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'Username already registered' });
                    }
                    return res.status(500).json({ error: aErr.message });
                }
                
                const userId = this.lastID;
                const apiKey = 'apiKey-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
                
                // Auto-bootstrap a first project board workspace
                db.run(
                    `INSERT INTO projects (organization_id, name, api_key, theme_color, button_position, welcome_title) VALUES (?, ?, ?, ?, ?, ?)`,
                    [orgId, 'First Workspace', apiKey, '#6366f1', 'right', 'Feature Requests'],
                    function(pErr) {
                        if (pErr) console.error("Failed auto-bootstrapping default workspace project:", pErr);
                        
                        const token = jwt.sign({ username, id: userId }, JWT_SECRET, { expiresIn: '24h' });
                        res.status(201).json({ success: true, token, username, org_name: orgName });
                    }
                );
            }
        );
    });
});

app.get('/api/verify', authenticateToken, (req, res) => {
    res.json({ success: true, user: req.user });
});

// --- Enterprise Organization & Roster API Endpoints [NEW] ---

app.get('/api/organization/details', authenticateToken, (req, res) => {
    db.get("SELECT * FROM organizations WHERE id = ?", [req.user.organization_id], (err, row) => {
        if (err || !row) {
            return res.status(404).json({ error: 'Organization data not found' });
        }
        res.json(row);
    });
});

app.get('/api/organization/members', authenticateToken, (req, res) => {
    db.all(
        "SELECT id, username, role, email FROM admin_users WHERE organization_id = ? ORDER BY id ASC", 
        [req.user.organization_id], 
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

app.post('/api/organization/invite', authenticateToken, requireRole(['owner', 'admin']), (req, res) => {
    const { username, password, email, role } = req.body;
    if (!username || !password || !email || !role) {
        return res.status(400).json({ error: 'All fields (username, password, email, role) are required' });
    }

    const allowedRoles = ['admin', 'member'];
    if (!allowedRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid user role selected' });
    }

    const hashed = hashPassword(password);
    db.run(
        "INSERT INTO admin_users (organization_id, username, password, role, email) VALUES (?, ?, ?, ?, ?)",
        [req.user.organization_id, username, hashed, role, email],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(400).json({ error: 'Username already exists' });
                }
                return res.status(500).json({ error: err.message });
            }
            res.status(201).json({
                id: this.lastID,
                username,
                role,
                email
            });
        }
    );
});

app.delete('/api/organization/members/:id', authenticateToken, requireRole(['owner']), (req, res) => {
    const { id } = req.params;
    
    // Prevent owners from deleting themselves
    if (parseInt(id) === req.user.id) {
        return res.status(400).json({ error: 'Owners cannot delete themselves from the roster' });
    }

    db.run("DELETE FROM admin_users WHERE id = ? AND organization_id = ?", [id, req.user.organization_id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: 'Teammate removed successfully' });
    });
});

// --- Projects API Endpoints (Organization-Scoped) ---

app.get('/api/projects', authenticateToken, (req, res) => {
    db.all(
        "SELECT * FROM projects WHERE organization_id = ? ORDER BY name ASC", 
        [req.user.organization_id], 
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

app.post('/api/projects', authenticateToken, requireRole(['owner', 'admin']), (req, res) => {
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Project name is required' });
    }
    
    const apiKey = 'apiKey-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
    
    db.run(
        `INSERT INTO projects (organization_id, name, api_key, theme_color, button_position, welcome_title) VALUES (?, ?, ?, ?, ?, ?)`,
        [req.user.organization_id, name, apiKey, '#6366f1', 'right', 'Feature Requests'],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.status(201).json({
                id: this.lastID,
                organization_id: req.user.organization_id,
                name,
                api_key: apiKey,
                theme_color: '#6366f1',
                button_position: 'right',
                welcome_title: 'Feature Requests'
            });
        }
    );
});

app.put('/api/projects/:id/theme', authenticateToken, requireRole(['owner', 'admin']), (req, res) => {
    const { id } = req.params;
    const { theme_color, button_position, welcome_title } = req.body;
    
    db.run(
        `UPDATE projects SET theme_color = ?, button_position = ?, welcome_title = ? WHERE id = ? AND organization_id = ?`,
        [theme_color || '#6366f1', button_position || 'right', welcome_title || 'Feature Requests', id, req.user.organization_id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, id, theme_color, button_position, welcome_title });
        }
    );
});

app.delete('/api/projects/:id', authenticateToken, requireRole(['owner']), (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM projects WHERE id = ? AND organization_id = ?", [id, req.user.organization_id], function(err) {
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


// --- Feedback API Endpoints (Public & Admin Scoped) ---

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

    // Heuristic Fallback Agent
    if (!geminiKey || !autoReplyComment) {
        const fullText = (title + ' ' + description).toLowerCase();
        if (/\b(crash|bug|error|broken|fail|issue|not working|broke|patch)\b/.test(fullText)) {
            finalCategory = 'bug';
        } else if (/\b(better|improve|cleaner|faster|slow|speed|ui|ux|design|aesthetic|adjust|align)\b/.test(fullText)) {
            finalCategory = 'improvement';
        } else {
            finalCategory = 'feature';
        }

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


// --- Scoped Feedback Admin Controllers ---

// Hardened status change with GitHub Issue Hook Simulation
app.put('/api/feedback/:id/status', authenticateToken, requireRole(['owner', 'admin']), (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    
    // Security check: ensure feedback belongs to the authenticated user's organization!
    db.get("SELECT f.title, f.category, p.organization_id FROM feedback f JOIN projects p ON f.project_id = p.id WHERE f.id = ?", [id], (err, row) => {
        if (err || !row) {
            return res.status(404).json({ error: 'Feedback not found' });
        }
        if (row.organization_id !== req.user.organization_id) {
            return res.status(403).json({ error: 'Forbidden: Cross-organization workspace access denied' });
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

                const syncMsg = `System: This feature request has been synchronized with the developer team on GitHub. Sync Issue #${Math.floor(Math.random() * 800) + 100} has been linked.`;
                db.run(
                    "INSERT INTO comments (feedback_id, author_name, author_role, content) VALUES (?, ?, ?, ?)",
                    [id, 'Developer Tools', 'admin', syncMsg]
                );
            }

            res.json({ success: true, id, status });
        });
    });
});

app.delete('/api/feedback/:id', authenticateToken, requireRole(['owner', 'admin']), (req, res) => {
    const { id } = req.params;
    
    // Security check: ensure feedback belongs to the authenticated user's organization!
    db.get("SELECT p.organization_id FROM feedback f JOIN projects p ON f.project_id = p.id WHERE f.id = ?", [id], (err, row) => {
        if (err || !row) {
            return res.status(404).json({ error: 'Feedback not found' });
        }
        if (row.organization_id !== req.user.organization_id) {
            return res.status(403).json({ error: 'Forbidden: Cross-organization workspace access denied' });
        }

        db.run("DELETE FROM feedback WHERE id = ?", [id], function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, message: 'Feedback deleted successfully' });
        });
    });
});

// --- Commenting API Endpoints (Scoped) ---

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
        name = req.user.role === 'owner' ? 'Product Owner' : (req.user.username === 'admin' ? 'Product Manager' : req.user.username);
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

// --- Scoped Rich Analytics API ---

app.get('/api/analytics', authenticateToken, (req, res) => {
    const stats = {};
    const orgId = req.user.organization_id;
    
    db.get("SELECT COUNT(*) as total FROM projects WHERE organization_id = ?", [orgId], (err, row) => {
        stats.total_projects = row ? row.total : 0;
        
        db.get("SELECT COUNT(*) as total, SUM(f.votes) as votes FROM feedback f JOIN projects p ON f.project_id = p.id WHERE p.organization_id = ?", [orgId], (err, row) => {
            stats.total_feedback = row ? row.total : 0;
            stats.total_votes = row && row.votes ? row.votes : 0;
            
            db.all("SELECT f.category, COUNT(*) as count FROM feedback f JOIN projects p ON f.project_id = p.id WHERE p.organization_id = ? GROUP BY f.category", [orgId], (err, rows) => {
                stats.categories = rows || [];
                
                db.all("SELECT f.status, COUNT(*) as count FROM feedback f JOIN projects p ON f.project_id = p.id WHERE p.organization_id = ? GROUP BY f.status", [orgId], (err, rows) => {
                    stats.statuses = rows || [];
                    
                    db.all(`
                        SELECT p.name as project_name, COUNT(f.id) as feedback_count, SUM(f.votes) as vote_count 
                        FROM projects p 
                        LEFT JOIN feedback f ON p.id = f.project_id 
                        WHERE p.organization_id = ?
                        GROUP BY p.id, p.name
                    `, [orgId], (err, rows) => {
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
