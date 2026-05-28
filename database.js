const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

const dbPath = path.resolve(__dirname, 'feedback.db');

// --- Cryptographic Password Hashing Helpers (Zero External NPM Dependencies!) ---
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    if (!storedHash || !storedHash.includes(':')) {
        // Fallback for old plain-text entries if they exist
        return password === storedHash;
    }
    const [salt, hash] = storedHash.split(':');
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
        // Migration Check: Check if feedback table exists and has project_id column
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='feedback'", (err, row) => {
            if (err) {
                console.error('Error checking schema:', err);
                return;
            }
            
            if (row) {
                // Table exists, check if project_id exists
                db.all("PRAGMA table_info(feedback)", (err, columns) => {
                    if (err) {
                        console.error('Error reading table info:', err);
                        return;
                    }
                    const hasProjectId = columns.some(c => c.name === 'project_id');
                    if (!hasProjectId) {
                        console.log('Detected obsolete database schema. Re-initializing schema for B2B SaaS features...');
                        recreateTables();
                    } else {
                        // All good, create any missing tables and seed
                        createTables();
                    }
                });
            } else {
                createTables();
            }
        });
    });
}

function recreateTables() {
    db.serialize(() => {
        db.run('DROP TABLE IF EXISTS comments');
        db.run('DROP TABLE IF EXISTS feedback');
        db.run('DROP TABLE IF EXISTS projects');
        db.run('DROP TABLE IF EXISTS admin_users');
        createTables();
    });
}

function createTables() {
    db.serialize(() => {
        // Enable Foreign Keys
        db.run('PRAGMA foreign_keys = ON');

        // 1. Create Projects
        db.run(`
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                api_key TEXT UNIQUE NOT NULL,
                theme_color TEXT DEFAULT '#6366f1',
                button_position TEXT DEFAULT 'right',
                welcome_title TEXT DEFAULT 'Feature Requests',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 2. Create Feedback with project_id relation
        db.run(`
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                category TEXT DEFAULT 'feature',
                status TEXT DEFAULT 'none',
                votes INTEGER DEFAULT 1,
                user_email TEXT,
                user_name TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
        `);

        // 3. Create Comments Table
        db.run(`
            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feedback_id INTEGER NOT NULL,
                author_name TEXT NOT NULL,
                author_role TEXT DEFAULT 'user',
                content TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE
            )
        `);

        // 4. Create Admin Users
        db.run(`
            CREATE TABLE IF NOT EXISTS admin_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            )
        `, (err) => {
            if (!err) {
                console.log('Database tables ready.');
                seedData();
            } else {
                console.error('Error creating admin_users table:', err);
            }
        });
    });
}

function seedData() {
    db.serialize(() => {
        // Seed Projects
        db.get("SELECT COUNT(*) AS count FROM projects", (err, row) => {
            if (!err && row.count === 0) {
                console.log('Seeding initial project workspace...');
                const projectsStmt = db.prepare(`
                    INSERT INTO projects (name, api_key, theme_color, button_position, welcome_title)
                    VALUES (?, ?, ?, ?, ?)
                `);
                
                projectsStmt.run(['Web Application', 'web-app-key-2026', '#6366f1', 'right', 'Feature Requests']);
                projectsStmt.run(['Mobile iOS App', 'ios-app-key-2026', '#10b981', 'right', 'Suggest Features']);
                projectsStmt.finalize(() => {
                    seedFeedbackAndComments();
                });
            } else {
                seedFeedbackAndComments();
            }
        });

        // Seed Admin User (Secured using PBKDF2 native hashing)
        db.get("SELECT COUNT(*) AS count FROM admin_users", (err, row) => {
            if (!err && row.count === 0) {
                console.log('Seeding default admin account securely...');
                const hashed = hashPassword('password123');
                db.run('INSERT INTO admin_users (username, password) VALUES (?, ?)', ['admin', hashed]);
            }
        });
    });
}

function seedFeedbackAndComments() {
    db.get("SELECT COUNT(*) AS count FROM feedback", (err, row) => {
        if (!err && row.count === 0) {
            console.log('Seeding sample feedbacks and threaded comments...');
            
            // Get the seeded projects to associate feedback correctly
            db.all("SELECT id, name FROM projects", (err, projects) => {
                if (err || projects.length === 0) return;
                
                const webProjId = projects.find(p => p.name === 'Web Application')?.id || projects[0].id;
                const mobileProjId = projects.find(p => p.name === 'Mobile iOS App')?.id || projects[0].id;

                // Insert feedback for Web Application
                const feedbackStmt = db.prepare(`
                    INSERT INTO feedback (project_id, title, description, category, status, votes, user_email, user_name)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `);

                feedbackStmt.run([
                    webProjId,
                    'Dark Mode Toggle',
                    'A highly requested aesthetic feature. My eyes hurt when looking at the dashboard late at night. Need a smooth theme switcher.',
                    'improvement',
                    'planned',
                    142,
                    'sarah.k@designco.com',
                    'Sarah Jenkins'
                ], function(err) {
                    if (err) return;
                    const feedbackId = this.lastID;
                    // Seed comments for this feedback
                    db.run(`INSERT INTO comments (feedback_id, author_name, author_role, content) VALUES (?, ?, ?, ?)`, [
                        feedbackId, 'Sarah Jenkins', 'user', 'Also, can we make sure it respects the system level preference (CSS prefers-color-scheme)?'
                    ]);
                    db.run(`INSERT INTO comments (feedback_id, author_name, author_role, content) VALUES (?, ?, ?, ?)`, [
                        feedbackId, 'Product Manager', 'admin', 'Absolutely! We will listen to standard window media matches so it switches automatically by default.'
                    ]);
                });

                feedbackStmt.run([
                    webProjId,
                    'Slack & Teams Notification Webhooks',
                    'It would save our operations team so much time if we could pipe feedback updates or new requests directly into our Slack channel.',
                    'feature',
                    'in-progress',
                    89,
                    'dev-ops-guru@hashnode.org',
                    'Alex Rivera'
                ], function(err) {
                    if (err) return;
                    const feedbackId = this.lastID;
                    db.run(`INSERT INTO comments (feedback_id, author_name, author_role, content) VALUES (?, ?, ?, ?)`, [
                        feedbackId, 'Product Manager', 'admin', 'We are currently building this. The Slack integration is scoped and scheduled for deployment early next week!'
                    ]);
                });

                feedbackStmt.run([
                    webProjId,
                    'Enterprise SAML / SSO Login',
                    'We are onboarding a large client and they refuse to use FeedbackFlow without strict SSO. Security compliance requires it.',
                    'feature',
                    'none',
                    215,
                    'ciso@enterprisecorp.com',
                    'Robert Chen'
                ]);

                feedbackStmt.run([
                    webProjId,
                    'Export Reports to CSV/JSON',
                    'Need a way to extract the feedback cards to CSV or Excel for quarterly reporting.',
                    'improvement',
                    'done',
                    45,
                    'analyst@growthco.io',
                    'Emily White'
                ]);

                // Insert feedback for Mobile App
                feedbackStmt.run([
                    mobileProjId,
                    'Biometric Face ID authentication',
                    'Logging in every time on iOS is painful. Please add native Apple FaceID support.',
                    'feature',
                    'in-progress',
                    95,
                    'ios-power-user@icloud.com',
                    'Danny Vance'
                ], function(err) {
                    if (err) return;
                    const feedbackId = this.lastID;
                    db.run(`INSERT INTO comments (feedback_id, author_name, author_role, content) VALUES (?, ?, ?, ?)`, [
                        feedbackId, 'Danny Vance', 'user', 'Any plans for TouchID fallback for older iPhones?'
                    ]);
                    db.run(`INSERT INTO comments (feedback_id, author_name, author_role, content) VALUES (?, ?, ?, ?)`, [
                        feedbackId, 'Lead iOS Developer', 'admin', 'Yes, LocalAuthentication handles both seamlessly. We will fall back to TouchID or passcode auto-prompting.'
                    ]);
                });

                feedbackStmt.run([
                    mobileProjId,
                    'App Widget on iOS Home Screen',
                    'A small iOS widget that shows my current active goals or metrics right on my home screen would be amazing.',
                    'feature',
                    'planned',
                    64,
                    'joshua.m@gmail.com',
                    'Joshua Miller'
                ]);

                feedbackStmt.run([
                    mobileProjId,
                    'Fix Android App Crash on launch',
                    'The app instantly crashes on Android 14. We need a critical bug fix.',
                    'bug',
                    'none',
                    12,
                    'trouble@android.com',
                    'Marcus Thorne'
                ], function(err) {
                    if (err) return;
                    const feedbackId = this.lastID;
                    db.run(`INSERT INTO comments (feedback_id, author_name, author_role, content) VALUES (?, ?, ?, ?)`, [
                        feedbackId, 'Marcus Thorne', 'user', 'Attached logs: java.lang.NullPointerException at com.feedbackflow.AuthActivity.onCreate...'
                    ]);
                    db.run(`INSERT INTO comments (feedback_id, author_name, author_role, content) VALUES (?, ?, ?, ?)`, [
                        feedbackId, 'Support Hero', 'admin', 'Thank you for providing the trace! Our engineering team has identified the issue and a hotfix is being compiled.'
                    ]);
                });

                feedbackStmt.finalize();
            });
        }
    });
}

module.exports = {
    db,
    hashPassword,
    verifyPassword
};
