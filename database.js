const sqlite3 = require('sqlite3').verbose();
const pg = require('pg');
const path = require('path');
const crypto = require('crypto');

const dbPath = path.resolve(__dirname, 'feedback.db');
const connectionString = process.env.DATABASE_URL || '';
const isPostgres = connectionString.startsWith('postgres://') || connectionString.startsWith('postgresql://');

let sqliteDb = null;
let pgPool = null;

// --- Cryptographic Password Hashing Helpers (Zero External NPM Dependencies!) ---
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    if (!storedHash || !storedHash.includes(':')) {
        return password === storedHash;
    }
    const [salt, hash] = storedHash.split(':');
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
}

// --- Universal Database Abstraction Layer ---
class DatabaseEngine {
    constructor() {
        if (isPostgres) {
            console.log('Connecting to PostgreSQL database...');
            pgPool = new pg.Pool({
                connectionString: connectionString,
                ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : false
            });
            pgPool.on('error', (err) => {
                console.error('Unexpected error on idle PostgreSQL client', err);
            });
            this.initDb();
        } else {
            console.log('Connecting to SQLite database...');
            sqliteDb = new sqlite3.Database(dbPath, (err) => {
                if (err) {
                    console.error('Error connecting to SQLite database:', err.message);
                } else {
                    console.log('Connected to SQLite database.');
                    this.initDb();
                }
            });
        }
    }

    // Helper to translate query dialects
    translateSql(sql) {
        if (!sql) return '';
        if (isPostgres) {
            let translated = sql;
            // Translate sqlite_master metadata checks to information_schema
            translated = translated.replace(/sqlite_master\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s*=\s*'/g, "information_schema.tables WHERE table_name = '");
            // Translate schema types
            translated = translated.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY');
            translated = translated.replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/g, 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
            translated = translated.replace(/DATETIME/g, 'TIMESTAMP');
            // Filter SQLite PRAGMAs out
            if (translated.includes('PRAGMA')) {
                return '';
            }
            return translated;
        }
        return sql;
    }

    // Helper to convert parameter placeholders (? -> $1, $2, ...)
    convertPlaceholders(sql) {
        if (!isPostgres) return sql;
        let index = 1;
        return sql.replace(/\?/g, () => `$${index++}`);
    }

    // --- Core Driver API Compatibility Layer ---
    
    serialize(callback) {
        if (isPostgres) {
            // Postgres pool natively handles concurrent requests. Run immediately.
            callback();
        } else {
            sqliteDb.serialize(callback);
        }
        return this;
    }

    run(sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        params = params || [];

        if (isPostgres) {
            let pgSql = this.translateSql(sql);
            if (!pgSql) {
                if (callback) callback(null);
                return this;
            }

            // Append RETURNING id clause on INSERT if not present
            if (pgSql.trim().toUpperCase().startsWith('INSERT') && !pgSql.toUpperCase().includes('RETURNING')) {
                pgSql += ' RETURNING id';
            }

            pgSql = this.convertPlaceholders(pgSql);

            pgPool.query(pgSql, params, (err, res) => {
                if (err) {
                    if (callback) callback(err);
                    return;
                }
                const context = {
                    lastID: res.rows && res.rows[0] ? res.rows[0].id : null,
                    changes: res.rowCount
                };
                if (callback) callback.call(context, null);
            });
        } else {
            sqliteDb.run(sql, params, callback);
        }
        return this;
    }

    get(sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        params = params || [];

        if (isPostgres) {
            let pgSql = this.translateSql(sql);
            if (!pgSql) {
                if (callback) callback(null, null);
                return this;
            }
            pgSql = this.convertPlaceholders(pgSql);

            pgPool.query(pgSql, params, (err, res) => {
                if (err) {
                    if (callback) callback(err, null);
                    return;
                }
                if (callback) callback(null, res.rows[0] || null);
            });
        } else {
            sqliteDb.get(sql, params, callback);
        }
        return this;
    }

    all(sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        params = params || [];

        if (isPostgres) {
            let pgSql = this.translateSql(sql);
            if (!pgSql) {
                if (callback) callback(null, []);
                return this;
            }
            pgSql = this.convertPlaceholders(pgSql);

            pgPool.query(pgSql, params, (err, res) => {
                if (err) {
                    if (callback) callback(err, null);
                    return;
                }
                if (callback) callback(null, res.rows || []);
            });
        } else {
            sqliteDb.all(sql, params, callback);
        }
        return this;
    }

    prepare(sql) {
        const self = this;
        return {
            run(params, callback) {
                self.run(sql, params, callback);
                return this;
            },
            finalize(callback) {
                if (callback) callback(null);
            }
        };
    }

    // --- Programmatic Self-Healing Database Migration ---
    initDb() {
        this.serialize(() => {
            // Check if tables already exist to run self-healing column insertions
            const checkSql = "SELECT name FROM sqlite_master WHERE type='table' AND name='feedback'";
            this.get(checkSql, (err, row) => {
                if (err) {
                    console.error('Error checking database tables:', err);
                    return;
                }
                
                // Baseline table creator
                this.createTables(() => {
                    // Self-healing columns checker
                    this.applySelfHealingMigrations();
                });
            });
        });
    }

    createTables(next) {
        // 1. Create Organizations Table [NEW]
        this.run(`
            CREATE TABLE IF NOT EXISTS organizations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                billing_tier TEXT DEFAULT 'free',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 2. Create Workspace Projects
        this.run(`
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id INTEGER,
                name TEXT NOT NULL,
                api_key TEXT UNIQUE NOT NULL,
                theme_color TEXT DEFAULT '#6366f1',
                button_position TEXT DEFAULT 'right',
                welcome_title TEXT DEFAULT 'Feature Requests',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
            )
        `);

        // 3. Create Feedback
        this.run(`
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

        // 4. Create Comments
        this.run(`
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

        // 5. Create Admin Users Table with Org Roles
        this.run(`
            CREATE TABLE IF NOT EXISTS admin_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id INTEGER,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT DEFAULT 'member',
                email TEXT,
                FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
            )
        `, (err) => {
            if (!err) {
                console.log('Baseline database tables ready.');
                if (next) next();
            } else {
                console.error('Error creating baseline database schemas:', err);
            }
        });
    }

    applySelfHealingMigrations() {
        console.log('Checking database schemas for self-healing migrations...');
        
        const checkColumns = (tableName, callback) => {
            if (isPostgres) {
                const sql = "SELECT column_name AS name FROM information_schema.columns WHERE table_name = ?";
                this.all(sql, [tableName], (err, rows) => {
                    if (err) callback(err, []);
                    else callback(null, rows.map(r => r.name));
                });
            } else {
                this.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
                    if (err) callback(err, []);
                    else callback(null, rows.map(r => r.name));
                });
            }
        };

        // 1. Healing 'projects' table (ensure organization_id exists)
        checkColumns('projects', (err, columns) => {
            if (err) return;
            if (!columns.includes('organization_id')) {
                console.log('Adding organization_id column to projects table...');
                this.run('ALTER TABLE projects ADD COLUMN organization_id INTEGER', (aErr) => {
                    if (aErr) console.error('Failed healing projects schema:', aErr);
                });
            }
        });

        // 2. Healing 'admin_users' table (ensure organization_id, role, email exist)
        checkColumns('admin_users', (err, columns) => {
            if (err) return;
            if (!columns.includes('organization_id')) {
                console.log('Adding organization_id column to admin_users table...');
                this.run('ALTER TABLE admin_users ADD COLUMN organization_id INTEGER');
            }
            if (!columns.includes('role')) {
                console.log('Adding role column to admin_users table...');
                this.run("ALTER TABLE admin_users ADD COLUMN role TEXT DEFAULT 'member'");
            }
            if (!columns.includes('email')) {
                console.log('Adding email column to admin_users table...');
                this.run('ALTER TABLE admin_users ADD COLUMN email TEXT');
            }
        });

        // Finally, run seed setup
        this.seedData();
    }

    seedData() {
        this.serialize(() => {
            // A. Seed Default Organization
            this.get("SELECT COUNT(*) AS count FROM organizations", (err, row) => {
                if (!err && row && parseInt(row.count) === 0) {
                    console.log('Seeding baseline organization...');
                    this.run("INSERT INTO organizations (name, billing_tier) VALUES (?, ?)", 
                        ['Awesome SaaS Inc.', 'enterprise'], 
                        (oErr) => {
                            if (!oErr) this.seedSecondaryData();
                        }
                    );
                } else {
                    this.seedSecondaryData();
                }
            });
        });
    }

    seedSecondaryData() {
        // Fetch default organization id
        this.get("SELECT id FROM organizations LIMIT 1", (err, org) => {
            if (err || !org) return;
            const orgId = org.id;

            // B. Seed Projects
            this.get("SELECT COUNT(*) AS count FROM projects", (pErr, pRow) => {
                if (!pErr && pRow && parseInt(pRow.count) === 0) {
                    console.log('Seeding baseline workspace projects...');
                    const stmt = this.prepare(`
                        INSERT INTO projects (organization_id, name, api_key, theme_color, button_position, welcome_title)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `);
                    stmt.run([orgId, 'Web Application', 'web-app-key-2026', '#6366f1', 'right', 'Feature Requests']);
                    stmt.run([orgId, 'Mobile iOS App', 'ios-app-key-2026', '#10b981', 'right', 'Suggest Features']);
                    stmt.finalize(() => {
                        this.seedFeedbackAndComments();
                    });
                } else {
                    this.seedFeedbackAndComments();
                }
            });

            // C. Seed Admin Account
            this.get("SELECT COUNT(*) AS count FROM admin_users", (aErr, aRow) => {
                if (!aErr && aRow && parseInt(aRow.count) === 0) {
                    console.log('Seeding secure admin credentials...');
                    const hash = hashPassword('password123');
                    this.run(`
                        INSERT INTO admin_users (organization_id, username, password, role, email)
                        VALUES (?, ?, ?, ?, ?)
                    `, [orgId, 'admin', hash, 'owner', 'admin@awesomesaas.com']);
                }
            });
        });
    }

    seedFeedbackAndComments() {
        this.get("SELECT COUNT(*) AS count FROM feedback", (err, row) => {
            if (!err && row && parseInt(row.count) === 0) {
                console.log('Seeding sample feedback boards...');
                
                this.all("SELECT id, name FROM projects", (fErr, projects) => {
                    if (fErr || !projects || projects.length === 0) return;
                    
                    const webProjId = projects.find(p => p.name === 'Web Application')?.id || projects[0].id;
                    const mobileProjId = projects.find(p => p.name === 'Mobile iOS App')?.id || projects[0].id;

                    const feedbackStmt = this.prepare(`
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
                    ], function(e) {
                        if (e) return;
                        const feedbackId = this.lastID;
                        sqliteDb ? sqliteDb.run(`INSERT INTO comments (feedback_id, author_name, author_role, content) VALUES (?, ?, ?, ?)`, [
                            feedbackId, 'Sarah Jenkins', 'user', 'Also, can we make sure it respects the system level preference (CSS prefers-color-scheme)?'
                        ]) : pgPool.query("INSERT INTO comments (feedback_id, author_name, author_role, content) VALUES ($1, $2, $3, $4)", [
                            feedbackId, 'Sarah Jenkins', 'user', 'Also, can we make sure it respects the system level preference (CSS prefers-color-scheme)?'
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
                    ]);

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
                        mobileProjId,
                        'Biometric Face ID authentication',
                        'Logging in every time on iOS is painful. Please add native Apple FaceID support.',
                        'feature',
                        'in-progress',
                        95,
                        'ios-power-user@icloud.com',
                        'Danny Vance'
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
                    ]);

                    feedbackStmt.finalize();
                });
            }
        });
    }
}

const dbInstance = new DatabaseEngine();

module.exports = {
    db: dbInstance,
    hashPassword,
    verifyPassword
};
