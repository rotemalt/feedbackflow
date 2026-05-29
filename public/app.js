/**
 * FeedbackFlow Console Engine - Component-Based SaaS Architecture (2026)
 */

class FeedbackApp {
    constructor() {
        this.token = localStorage.getItem('ff_admin_token');
        this.projects = [];
        this.activeProject = null;
        this.feedbackItems = [];
        
        // Active workspace metrics cache
        this.analyticsData = null;

        // Sub-Components
        this.projectManager = null;
        this.toolbar = null;
        this.detailDrawer = null;
        this.roadmapBoard = null;
        this.widgetCustomizer = null;
        this.analyticsDashboard = null;

        this.initDOM();
        this.bindEvents();
        
        window.FeedbackFlowAppInstance = this;

        // Bootstrapping: Silently verify credentials and fetch starting workspaces
        this.checkAuth();
    }

    async checkAuth() {
        if (!this.token) {
            this.showLanding();
            return;
        }

        try {
            const res = await fetch('/api/verify', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (res.ok) {
                this.launchApp();
            } else {
                this.logout();
            }
        } catch (e) {
            this.logout();
        }
    }

    showLanding() {
        document.getElementById('marketing-nav').style.display = 'flex';
        document.getElementById('app-view').classList.remove('active');
        document.getElementById('landing-view').classList.add('active');
    }

    openLoginModal() {
        document.getElementById('login-modal').classList.add('active');
    }

    closeLoginModal() {
        document.getElementById('login-modal').classList.remove('active');
    }

    async launchApp() {
        this.closeLoginModal();
        document.getElementById('marketing-nav').style.display = 'none';
        document.getElementById('landing-view').classList.remove('active');
        document.getElementById('app-view').classList.add('active');
        
        // Fetch detailed profile credentials
        try {
            const profileRes = await fetch('/api/verify', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (profileRes.ok) {
                const data = await profileRes.json();
                this.currentUser = data.user;
                
                // Update Sidebar Profile Badge
                const avatarEl = document.querySelector('.user-avatar');
                const nameEl = document.querySelector('.user-name');
                const roleEl = document.querySelector('.user-role');
                if (avatarEl) avatarEl.textContent = this.currentUser.username.substring(0, 1).toUpperCase();
                if (nameEl) nameEl.textContent = this.currentUser.username;
                if (roleEl) roleEl.textContent = this.currentUser.role.toUpperCase();
            }
        } catch (e) {
            console.error("Failed loading user profile validation", e);
        }

        // Initialize modular components after login
        this.projectManager = new ProjectManager(this);
        this.toolbar = new FeedbackToolbar(this);
        this.detailDrawer = new FeedbackDetailDrawer(this);
        this.roadmapBoard = new RoadmapBoard(this);
        this.widgetCustomizer = new WidgetCustomizer(this);
        this.analyticsDashboard = new AnalyticsDashboard(this);

        // Fetch primary SaaS workspaces
        await this.projectManager.loadProjects();
    }

    logout() {
        this.token = null;
        localStorage.removeItem('ff_admin_token');
        this.showLanding();
    }

    async fetchFeedbackData() {
        if (!this.activeProject) return;
        
        try {
            const res = await fetch(`/api/feedback?projectId=${this.activeProject.id}`);
            if (res.ok) {
                this.feedbackItems = await res.ok ? await res.json() : [];
                this.renderAllPanes();
            }
        } catch (e) {
            console.error("Failed to load project feedback data", e);
        }
    }

    async fetchAnalyticsData() {
        try {
            const res = await fetch('/api/analytics', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (res.ok) {
                this.analyticsData = await res.json();
                if (this.analyticsDashboard) {
                    this.analyticsDashboard.render(this.analyticsData);
                }
            }
        } catch (e) {
            console.error("Failed loading analytics aggregates", e);
        }
    }

    renderAllPanes() {
        // Redraw lists
        this.renderFeedbackGrid();
        if (this.roadmapBoard) this.roadmapBoard.render();
        if (this.widgetCustomizer) this.widgetCustomizer.syncPreview();
    }

    renderFeedbackGrid() {
        const grid = document.getElementById('feedback-list-container');
        if (!grid) return;

        let filtered = [...this.feedbackItems];

        // Apply toolbar search
        if (this.toolbar) {
            const query = this.toolbar.searchQuery.toLowerCase();
            const category = this.toolbar.categoryFilter;
            const status = this.toolbar.statusFilter;

            if (query) {
                filtered = filtered.filter(item => 
                    item.title.toLowerCase().includes(query) || 
                    item.description.toLowerCase().includes(query) ||
                    (item.user_email && item.user_email.toLowerCase().includes(query))
                );
            }
            if (category !== 'all') {
                filtered = filtered.filter(item => item.category === category);
            }
            if (status !== 'all') {
                filtered = filtered.filter(item => item.status === status);
            }
        }

        if (filtered.length === 0) {
            grid.innerHTML = `
                <div class="glass-panel" style="padding:3rem; text-align:center; color:var(--text-secondary);">
                    <h4>No feature requests matching this filter</h4>
                    <p style="margin-top:6px; font-size:0.9rem;">Submit requests on your embed widget to see them populate here!</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = filtered.map(item => `
            <div class="feedback-card" data-id="${item.id}">
                <div class="vote-box">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="margin-bottom: 2px;"><path d="M18 15l-6-6-6 6"/></svg>
                    <span class="vote-count">${item.votes}</span>
                </div>
                <div class="feedback-content">
                    <h3>${this.escapeHTML(item.title)}</h3>
                    <p>${this.escapeHTML(item.description)}</p>
                    <div class="card-tags">
                        <span class="category-badge ${item.category}">${item.category}</span>
                        ${item.status !== 'none' ? `<span class="status-badge ${item.status}">${item.status}</span>` : ''}
                        ${item.user_email ? `<span style="font-size:0.8rem; color:var(--text-muted); font-weight:600;">by ${this.escapeHTML(item.user_name || item.user_email)}</span>` : ''}
                    </div>
                </div>
                <div class="comment-indicator">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                    <span>Inspect</span>
                </div>
            </div>
        `).join('');

        // Attach click triggers to individual cards
        grid.querySelectorAll('.feedback-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = parseInt(card.dataset.id);
                const feedbackItem = this.feedbackItems.find(f => f.id === id);
                if (feedbackItem && this.detailDrawer) {
                    this.detailDrawer.open(feedbackItem);
                }
            });
        });
    }

    initDOM() {
        this.navBtns = document.querySelectorAll('.nav-btn');
        this.panes = {
            'analytics-board': document.getElementById('analytics-board'),
            'feedback-board': document.getElementById('feedback-board'),
            'roadmap-board': document.getElementById('roadmap-board'),
            'customizer-board': document.getElementById('customizer-board'),
            'team-board': document.getElementById('team-board')
        };
    }

    bindEvents() {
        // Landing navigation
        document.getElementById('btn-open-login').addEventListener('click', () => this.openLoginModal());
        document.getElementById('btn-close-login').addEventListener('click', () => this.closeLoginModal());
        
        document.getElementById('login-modal').addEventListener('click', (e) => {
            if (e.target.id === 'login-modal') this.closeLoginModal();
        });

        // Sign In Form submission
        document.getElementById('form-login').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('login-user').value;
            const password = document.getElementById('login-pass').value;
            const errorEl = document.getElementById('login-error');
            const submitBtn = e.target.querySelector('button[type="submit"]');
            
            submitBtn.textContent = 'Verifying security keys...';
            submitBtn.disabled = true;

            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                if (res.ok) {
                    const data = await res.json();
                    this.token = data.token;
                    localStorage.setItem('ff_admin_token', this.token);
                    errorEl.style.display = 'none';
                    this.launchApp();
                } else {
                    errorEl.style.display = 'block';
                }
            } catch (e) {
                errorEl.style.display = 'block';
            } finally {
                submitBtn.textContent = 'Sign In to Dashboard';
                submitBtn.disabled = false;
            }
        });

        document.getElementById('btn-logout').addEventListener('click', () => this.logout());

        // Team invite form
        const formInvite = document.getElementById('form-invite-member');
        if (formInvite) {
            formInvite.addEventListener('submit', (e) => this.inviteTeamMember(e));
        }

        // Navigation tab selections
        this.navBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget.dataset.target;
                this.switchPane(target);
            });
        });
    }

    switchPane(paneId) {
        this.navBtns.forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.querySelector(`[data-target="${paneId}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        Object.values(this.panes).forEach(pane => {
            if (pane) pane.classList.remove('active');
        });
        
        const targetPane = this.panes[paneId];
        if (targetPane) {
            targetPane.classList.add('active');
            
            // Refresh data context based on pane selected
            if (paneId === 'analytics-board') {
                this.fetchAnalyticsData();
            } else if (paneId === 'team-board') {
                this.fetchTeamRoster();
            } else {
                this.fetchFeedbackData();
            }
        }
    }

    escapeHTML(str) {
        if (!str) return '';
        return str.replace(/[&<>'"]/g, 
            tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
        );
    }
}

/**
 * Component: ProjectManager
 * Handles Workspace drop downs, custom creation, database synchronization.
 */
class ProjectManager {
    constructor(app) {
        this.app = app;
        this.selector = document.getElementById('project-selector');
        this.btnNew = document.getElementById('btn-add-project');
        this.modal = document.getElementById('project-create-modal');
        this.btnClose = document.getElementById('btn-close-project-modal');
        this.form = document.getElementById('form-create-project');

        this.bindEvents();
    }

    bindEvents() {
        this.selector.addEventListener('change', () => {
            const selectedId = parseInt(this.selector.value);
            const selectedProj = this.app.projects.find(p => p.id === selectedId);
            if (selectedProj) {
                this.app.activeProject = selectedProj;
                this.app.fetchFeedbackData();
            }
        });

        this.btnNew.addEventListener('click', () => this.openModal());
        this.btnClose.addEventListener('click', () => this.closeModal());
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.closeModal();
        });

        this.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('project-name-input').value;
            
            try {
                const res = await fetch('/api/projects', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.app.token}`
                    },
                    body: JSON.stringify({ name })
                });

                if (res.ok) {
                    const newProj = await res.json();
                    this.form.reset();
                    this.closeModal();
                    await this.loadProjects(newProj.id);
                }
            } catch (err) {
                console.error(err);
            }
        });
    }

    openModal() { this.modal.classList.add('active'); }
    closeModal() { this.modal.classList.remove('active'); }

    async loadProjects(selectProjectId = null) {
        try {
            const res = await fetch('/api/projects', {
                headers: { 'Authorization': `Bearer ${this.app.token}` }
            });
            if (res.ok) {
                this.app.projects = await res.json();
                this.render();
                
                // Select active project
                if (this.app.projects.length > 0) {
                    let target = this.app.projects[0];
                    if (selectProjectId) {
                        target = this.app.projects.find(p => p.id === selectProjectId) || target;
                    }
                    this.app.activeProject = target;
                    this.selector.value = target.id;
                    
                    // Fetch starting lists
                    this.app.fetchFeedbackData();
                    this.app.fetchAnalyticsData();
                }
            }
        } catch (e) {
            console.error("Failed loading workspaces projects list", e);
        }
    }

    render() {
        this.selector.innerHTML = this.app.projects.map(proj => 
            `<option value="${proj.id}">${this.app.escapeHTML(proj.name)}</option>`
        ).join('');
        
        if (this.app.activeProject) {
            this.selector.value = this.app.activeProject.id;
        }
    }
}

/**
 * Component: FeedbackToolbar
 * Handles real-time board filters and search matches.
 */
class FeedbackToolbar {
    constructor(app) {
        this.app = app;
        this.searchEl = document.getElementById('toolbar-search');
        this.categoryEl = document.getElementById('toolbar-filter-category');
        this.statusEl = document.getElementById('toolbar-filter-status');
        
        this.searchQuery = '';
        this.categoryFilter = 'all';
        this.statusFilter = 'all';

        this.bindEvents();
    }

    bindEvents() {
        // Debounce text filtering
        let debounceTimer;
        this.searchEl.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                this.searchQuery = e.target.value;
                this.app.renderFeedbackGrid();
            }, 250);
        });

        const handleSelectChange = () => {
            this.categoryFilter = this.categoryEl.value;
            this.statusFilter = this.statusEl.value;
            this.app.renderFeedbackGrid();
        };

        this.categoryEl.addEventListener('change', handleSelectChange);
        this.statusEl.addEventListener('change', handleSelectChange);
    }
}

/**
 * Component: FeedbackDetailDrawer
 * Slide-out drawer displaying descriptions, status changes, voter parameters, comments thread.
 */
class FeedbackDetailDrawer {
    constructor(app) {
        this.app = app;
        this.overlay = document.getElementById('drawer-feedback');
        this.btnClose = document.getElementById('btn-close-drawer');
        
        this.elCategory = document.getElementById('drawer-category-badge');
        this.elTitle = document.getElementById('drawer-title');
        this.elDesc = document.getElementById('drawer-description');
        this.elAuthor = document.getElementById('drawer-author');
        this.elVotes = document.getElementById('drawer-votes');
        
        this.statusSelect = document.getElementById('drawer-status-select');
        this.btnDelete = document.getElementById('btn-drawer-delete');

        this.activeItem = null;
        this.commentThread = new CommentThread(app, this);

        this.bindEvents();
    }

    bindEvents() {
        this.btnClose.addEventListener('click', () => this.close());
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.close();
        });

        this.statusSelect.addEventListener('change', async () => {
            if (!this.activeItem) return;
            const newStatus = this.statusSelect.value;
            try {
                const res = await fetch(`/api/feedback/${this.activeItem.id}/status`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.app.token}`
                    },
                    body: JSON.stringify({ status: newStatus })
                });

                if (res.ok) {
                    this.activeItem.status = newStatus;
                    this.app.fetchFeedbackData(); // Refresh board background state
                }
            } catch (e) {
                console.error(e);
            }
        });

        this.btnDelete.addEventListener('click', async () => {
            if (!this.activeItem || !confirm("Are you sure you want to delete this feedback card? This action is permanent!")) return;
            
            try {
                const res = await fetch(`/api/feedback/${this.activeItem.id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${this.app.token}` }
                });
                if (res.ok) {
                    this.close();
                    this.app.fetchFeedbackData(); // Refresh list
                }
            } catch (e) { console.error(e); }
        });
    }

    open(item) {
        this.activeItem = item;
        
        // Hydrate Drawer details
        this.elCategory.className = `category-badge ${item.category}`;
        this.elCategory.textContent = item.category;
        
        this.elTitle.textContent = item.title;
        this.elDesc.textContent = item.description;
        this.elAuthor.textContent = item.user_email ? `${item.user_name || 'User'} (${item.user_email})` : 'Anonymous Client';
        this.elVotes.textContent = item.votes;
        this.statusSelect.value = item.status;

        // Load threaded comments
        this.commentThread.loadComments(item.id);

        this.overlay.classList.add('active');
    }

    close() {
        this.overlay.classList.remove('active');
        this.activeItem = null;
    }
}

/**
 * Component: CommentThread
 * Displays nested user / admin discussion lists, formats replies.
 */
class CommentThread {
    constructor(app, drawer) {
        this.app = app;
        this.drawer = drawer;
        
        this.listContainer = document.getElementById('drawer-comments-list');
        this.form = document.getElementById('drawer-comment-form');
        this.input = document.getElementById('drawer-comment-input');

        this.comments = [];
        this.activeFeedbackId = null;

        this.bindEvents();
    }

    bindEvents() {
        this.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!this.activeFeedbackId) return;

            const content = this.input.value;
            const submitBtn = this.form.querySelector('button[type="submit"]');
            
            submitBtn.textContent = 'Publishing reply...';
            submitBtn.disabled = true;

            try {
                const res = await fetch(`/api/feedback/${this.activeFeedbackId}/comments`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.app.token}`
                    },
                    body: JSON.stringify({ content })
                });

                if (res.ok) {
                    this.input.value = '';
                    await this.loadComments(this.activeFeedbackId);
                }
            } catch (e) {
                console.error(e);
            } finally {
                submitBtn.textContent = 'Post Comment';
                submitBtn.disabled = false;
            }
        });
    }

    async loadComments(feedbackId) {
        this.activeFeedbackId = feedbackId;
        this.listContainer.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:1rem;">Fetching thread...</div>`;
        
        try {
            const res = await fetch(`/api/feedback/${feedbackId}/comments`);
            if (res.ok) {
                this.comments = await res.json();
                this.render();
            }
        } catch (e) {
            console.error("Failed loading comments thread", e);
        }
    }

    render() {
        if (this.comments.length === 0) {
            this.listContainer.innerHTML = `
                <div style="text-align:center; color:var(--text-muted); padding:2rem 1rem; border-radius:10px; background:rgba(255,255,255,0.01);">
                    <p style="font-size:0.85rem;">No discussion yet on this card.</p>
                    <p style="font-size:0.75rem; opacity:0.5;">Post an update below to start the thread!</p>
                </div>
            `;
            return;
        }

        this.listContainer.innerHTML = this.comments.map(c => {
            const isAdmin = c.author_role === 'admin';
            const formattedTime = new Date(c.created_at).toLocaleDateString(undefined, { 
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
            });
            
            return `
                <div class="comment-bubble ${isAdmin ? 'admin' : ''}">
                    <div class="comment-meta-row">
                        <div>
                            <span class="comment-author">${this.app.escapeHTML(c.author_name)}</span>
                            ${isAdmin ? `<span class="comment-role-tag">Team</span>` : ''}
                        </div>
                        <span class="comment-time">${formattedTime}</span>
                    </div>
                    <div class="comment-body">${this.app.escapeHTML(c.content)}</div>
                </div>
            `;
        }).join('');
        
        // Scroll list to bottom
        this.listContainer.scrollTop = this.listContainer.scrollHeight;
    }
}

/**
 * Component: RoadmapBoard
 * Handles column rendering on the Kanban page, implements drag or click state modification.
 */
class RoadmapBoard {
    constructor(app) {
        this.app = app;
        this.elPlanned = document.getElementById('rm-planned');
        this.elProgress = document.getElementById('rm-in-progress');
        this.elDone = document.getElementById('rm-completed');
        
        this.cntPlanned = document.getElementById('count-planned');
        this.cntProgress = document.getElementById('count-in-progress');
        this.cntDone = document.getElementById('count-completed');
    }

    render() {
        const planned = this.app.feedbackItems.filter(i => i.status === 'planned');
        const inProgress = this.app.feedbackItems.filter(i => i.status === 'in-progress');
        const completed = this.app.feedbackItems.filter(i => i.status === 'done');

        this.cntPlanned.textContent = planned.length;
        this.cntProgress.textContent = inProgress.length;
        this.cntDone.textContent = completed.length;

        const cardMapper = item => `
            <div class="rm-card" data-id="${item.id}">
                <h4>${this.app.escapeHTML(item.title)}</h4>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
                    <span class="category-badge ${item.category}" style="font-size:0.65rem; padding: 2px 6px;">${item.category}</span>
                    <span style="font-family:var(--font-mono); font-size:0.75rem; font-weight:700; color:var(--text-muted);">${item.votes} Votes</span>
                </div>
            </div>
        `;

        this.elPlanned.innerHTML = planned.length > 0 ? planned.map(cardMapper).join('') : `<div style="text-align:center;color:var(--text-muted);font-size:0.8rem;padding:2rem 0;">No items</div>`;
        this.elProgress.innerHTML = inProgress.length > 0 ? inProgress.map(cardMapper).join('') : `<div style="text-align:center;color:var(--text-muted);font-size:0.8rem;padding:2rem 0;">No items</div>`;
        this.elDone.innerHTML = completed.length > 0 ? completed.map(cardMapper).join('') : `<div style="text-align:center;color:var(--text-muted);font-size:0.8rem;padding:2rem 0;">No items</div>`;

        // Attach modal trigger clicks
        document.querySelectorAll('.rm-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = parseInt(card.dataset.id);
                const item = this.app.feedbackItems.find(f => f.id === id);
                if (item && this.app.detailDrawer) {
                    this.app.detailDrawer.open(item);
                }
            });
        });
    }
}

/**
 * Component: WidgetCustomizer
 * Handles color selector sliders, sandbox frame customization parameters sync.
 */
class WidgetCustomizer {
    constructor(app) {
        this.app = app;
        this.inputColor = document.getElementById('theme-color-input');
        this.inputHex = document.getElementById('theme-color-hex');
        this.inputTitle = document.getElementById('widget-title-input');
        this.inputPosition = document.getElementById('widget-position-input');
        this.btnSave = document.getElementById('btn-save-customizer');
        
        this.snippetCode = document.getElementById('snippet-code');
        this.btnCopy = document.getElementById('btn-copy');

        // Standalone shareable portal hooks
        this.inputPortalUrl = document.getElementById('share-portal-url');
        this.btnCopyPortal = document.getElementById('btn-copy-portal-url');
        this.btnViewPortal = document.getElementById('btn-view-portal');

        this.bindEvents();
    }

    bindEvents() {
        // Sync color picker with text hex input
        this.inputColor.addEventListener('input', (e) => {
            this.inputHex.value = e.target.value.toUpperCase();
            this.applySandboxStyles();
        });

        this.inputHex.addEventListener('input', (e) => {
            const val = e.target.value;
            if (/^#[0-9A-F]{6}$/i.test(val)) {
                this.inputColor.value = val;
                this.applySandboxStyles();
            }
        });

        this.inputTitle.addEventListener('input', () => this.applySandboxStyles());
        this.inputPosition.addEventListener('change', () => this.applySandboxStyles());

        this.btnSave.addEventListener('click', async () => {
            if (!this.app.activeProject) return;

            const theme_color = this.inputColor.value;
            const welcome_title = this.inputTitle.value;
            const button_position = this.inputPosition.value;

            this.btnSave.textContent = 'Saving configs...';
            this.btnSave.disabled = true;

            try {
                const res = await fetch(`/api/projects/${this.app.activeProject.id}/theme`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.app.token}`
                    },
                    body: JSON.stringify({ theme_color, welcome_title, button_position })
                });

                if (res.ok) {
                    // Update active project config
                    this.app.activeProject.theme_color = theme_color;
                    this.app.activeProject.welcome_title = welcome_title;
                    this.app.activeProject.button_position = button_position;
                    
                    // Reload widget instance with updated theme configs
                    if (window.FeedbackFlowInstance) {
                        window.FeedbackFlowInstance.reconfigure(this.app.activeProject.api_key);
                    }
                }
            } catch (err) {
                console.error(err);
            } finally {
                this.btnSave.textContent = 'Save Brand Configuration';
                this.btnSave.disabled = false;
            }
        });

        // Snippet copy helper
        this.btnCopy.addEventListener('click', () => {
            const text = this.snippetCode.textContent;
            navigator.clipboard.writeText(text);
            this.btnCopy.textContent = 'Copied!';
            setTimeout(() => this.btnCopy.textContent = 'Copy Code', 2000);
        });

        // Standalone shareable portal copy helper
        this.btnCopyPortal.addEventListener('click', () => {
            const text = this.inputPortalUrl.value;
            navigator.clipboard.writeText(text);
            this.btnCopyPortal.textContent = 'Copied!';
            setTimeout(() => this.btnCopyPortal.textContent = 'Copy', 2000);
        });

        // Standalone shareable portal view helper
        this.btnViewPortal.addEventListener('click', () => {
            window.open(this.inputPortalUrl.value, '_blank');
        });
    }

    applySandboxStyles() {
        const primaryColor = this.inputColor.value;
        const position = this.inputPosition.value;

        // Apply styled theme overrides dynamically to the demo widget floating on this dashboard
        if (window.FeedbackFlowInstance) {
            const container = document.getElementById('feedbackflow-widget-container');
            if (container) {
                container.style.left = position === 'left' ? '24px' : 'auto';
                container.style.right = position === 'right' ? '24px' : 'auto';
                
                const shadow = container.shadowRoot;
                if (shadow) {
                    const btn = shadow.getElementById('ff-trigger');
                    if (btn) btn.style.backgroundColor = primaryColor;
                    
                    const submitBtn = shadow.querySelector('.ff-btn-submit');
                    if (submitBtn) submitBtn.style.backgroundColor = primaryColor;

                    const headerTitle = shadow.querySelector('.ff-header h3');
                    if (headerTitle) headerTitle.textContent = this.inputTitle.value;
                }
            }
        }
    }

    syncPreview() {
        if (!this.app.activeProject) return;
        const proj = this.app.activeProject;
        
        this.inputColor.value = proj.theme_color || '#6366f1';
        this.inputHex.value = (proj.theme_color || '#6366f1').toUpperCase();
        this.inputTitle.value = proj.welcome_title || 'Feature Requests';
        this.inputPosition.value = proj.button_position || 'right';

        // Render copy snippet block
        const host = window.location.origin;
        const snippet = `<!-- FeedbackFlow Integration Widget -->\n<script src="${host}/widget.js" data-project-key="${proj.api_key}"></script>`;
        this.snippetCode.textContent = snippet;

        // Render shareable portal URL
        const portalUrl = `${host}/portal.html?key=${proj.api_key}`;
        this.inputPortalUrl.value = portalUrl;

        // Force launch the page preview widget bound to this project key
        if (window.FeedbackFlowInstance) {
            window.FeedbackFlowInstance.reconfigure(proj.api_key);
        }
        
        setTimeout(() => this.applySandboxStyles(), 150);
    }
}

/**
 * Component: AnalyticsDashboard
 * Dynamically builds SVG trends and responsive bar ratios in real time.
 */
class AnalyticsDashboard {
    constructor(app) {
        this.app = app;
        this.cntFeedback = document.getElementById('stat-total-feedback');
        this.cntVotes = document.getElementById('stat-total-votes');
        this.cntProjects = document.getElementById('stat-total-projects');
        
        this.elCategories = document.getElementById('chart-categories');
        this.elStatuses = document.getElementById('chart-statuses');
        this.elTable = document.getElementById('table-project-breakdown');
    }

    render(data) {
        if (!data) return;

        this.cntFeedback.textContent = data.total_feedback || 0;
        this.cntVotes.textContent = data.total_votes || 0;
        this.cntProjects.textContent = data.total_projects || 0;

        // 1. Render Category Breakdown
        const cats = data.categories || [];
        const maxVal = Math.max(...cats.map(c => c.count), 1);
        
        const catMap = {
            'feature': 'Features',
            'bug': 'Bugs',
            'improvement': 'Improvements'
        };

        this.elCategories.innerHTML = ['feature', 'bug', 'improvement'].map(cType => {
            const matched = cats.find(c => c.category === cType);
            const count = matched ? matched.count : 0;
            const pct = (count / maxVal) * 100;
            
            return `
                <div class="chart-row">
                    <span class="chart-label">${catMap[cType]}</span>
                    <div class="chart-track">
                        <div class="chart-bar ${cType}" style="width: ${pct}%"></div>
                    </div>
                    <span class="chart-val">${count}</span>
                </div>
            `;
        }).join('');

        // 2. Render Statuses Breakdown legend
        const stats = data.statuses || [];
        const statPlanned = stats.find(s => s.status === 'planned')?.count || 0;
        const statProgress = stats.find(s => s.status === 'in-progress')?.count || 0;
        const statCompleted = stats.find(s => s.status === 'done')?.count || 0;
        const statNew = stats.find(s => s.status === 'none')?.count || 0;

        this.elStatuses.innerHTML = `
            <div class="status-chart-legend">
                <div class="legend-item">
                    <span class="legend-label-col"><span class="legend-dot none"></span>Unscheduled</span>
                    <span class="legend-count">${statNew}</span>
                </div>
                <div class="legend-item">
                    <span class="legend-label-col"><span class="legend-dot planned"></span>Planned</span>
                    <span class="legend-count">${statPlanned}</span>
                </div>
                <div class="legend-item">
                    <span class="legend-label-col"><span class="legend-dot in-progress"></span>In Progress</span>
                    <span class="legend-count">${statProgress}</span>
                </div>
                <div class="legend-item">
                    <span class="legend-label-col"><span class="legend-dot completed"></span>Completed</span>
                    <span class="legend-count">${statCompleted}</span>
                </div>
            </div>
        `;

        // 3. Render Projects Share Table
        const projects = data.projects_breakdown || [];
        const maxProjVotes = Math.max(...projects.map(p => p.vote_count), 1);

        if (projects.length === 0) {
            this.elTable.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No workspaces active.</td></tr>`;
            return;
        }

        this.elTable.innerHTML = projects.map(p => {
            const feedCount = p.feedback_count || 0;
            const voteCount = p.vote_count || 0;
            const engPct = Math.min((voteCount / maxProjVotes) * 100, 100);
            
            return `
                <tr>
                    <td><strong style="color:#ffffff;">${this.app.escapeHTML(p.project_name)}</strong></td>
                    <td style="font-family:var(--font-mono);">${feedCount}</td>
                    <td style="font-family:var(--font-mono);">${voteCount}</td>
                    <td>
                        <div style="display:flex; align-items:center; gap:12px;">
                            <div class="engagement-bar-track">
                                <div class="engagement-bar" style="width: ${engPct}%"></div>
                            </div>
                            <span style="font-size:0.8rem; font-weight:700; color:var(--text-secondary);">${Math.round(engPct)}%</span>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    async fetchTeamRoster() {
        try {
            // A. Fetch Organization Details
            const orgRes = await fetch('/api/organization/details', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (orgRes.ok) {
                const org = await orgRes.json();
                const badge = document.getElementById('org-billing-badge');
                if (badge) {
                    badge.innerHTML = `
                        <span style="width: 8px; height: 8px; border-radius: 50%; background: #6366f1; display: inline-block;"></span>
                        ${org.name} (${org.billing_tier.toUpperCase()})
                    `;
                }
            }

            // B. Fetch Members Roster
            const membersRes = await fetch('/api/organization/members', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (membersRes.ok) {
                const members = await membersRes.json();
                this.renderTeamRoster(members);
            }
        } catch (e) {
            console.error("Failed fetching team roster", e);
        }
    }

    renderTeamRoster(members) {
        const mount = document.getElementById('team-roster-mount');
        if (!mount) return;

        if (members.length === 0) {
            mount.innerHTML = `<tr><td colspan="4" style="padding: 2rem; text-align: center; color: var(--text-muted);">No team members found.</td></tr>`;
            return;
        }

        const isOwner = this.currentUser?.role === 'owner';

        mount.innerHTML = members.map(member => {
            const isSelf = this.currentUser?.id === member.id;
            const removeBtn = (isOwner && !isSelf) 
                ? `<button class="btn-secondary" onclick="window.FeedbackFlowAppInstance.removeTeamMember(${member.id})" style="padding: 4px 8px; font-size: 0.75rem; border-color: rgba(248,113,113,0.3); color: #f87171; background: rgba(248,113,113,0.05); border-radius: 4px; cursor: pointer;">Remove</button>`
                : `<span style="color: var(--text-muted); font-size: 0.75rem;">None</span>`;

            const roleBadgeClass = member.role === 'owner' ? ' planned' : (member.role === 'admin' ? ' feature' : ' done');
            const roleBadgeLabel = member.role.toUpperCase();

            return `
                <tr style="border-bottom: 1px solid var(--border-subtle); color: var(--text-primary);">
                    <td style="padding: 12px 8px; font-weight: 600;">
                        ${this.escapeHTML(member.username)} ${isSelf ? ' <span style="font-size: 0.7rem; color: var(--accent);">(You)</span>' : ''}
                    </td>
                    <td style="padding: 12px 8px; color: var(--text-secondary);">${this.escapeHTML(member.email || 'N/A')}</td>
                    <td style="padding: 12px 8px;">
                        <span class="ff-cat-tag ${roleBadgeClass}" style="font-size: 0.65rem; border-radius: 4px; padding: 2px 6px;">${roleBadgeLabel}</span>
                    </td>
                    <td style="padding: 12px 8px; text-align: right;">${removeBtn}</td>
                </tr>
            `;
        }).join('');
    }

    async inviteTeamMember(e) {
        e.preventDefault();
        
        const username = document.getElementById('invite-username').value;
        const email = document.getElementById('invite-email').value;
        const password = document.getElementById('invite-password').value;
        const role = document.getElementById('invite-role').value;
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.textContent = 'Sending Invitation...';
        submitBtn.disabled = true;

        try {
            const res = await fetch('/api/organization/invite', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ username, password, email, role })
            });

            if (res.ok) {
                e.target.reset();
                this.fetchTeamRoster();
            } else {
                const data = await res.json();
                alert(`Invite Failed: ${data.error || 'Unknown error'}`);
            }
        } catch (e) {
            console.error("Invite Member Error:", e);
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    }

    async removeTeamMember(id) {
        if (!confirm("Are you absolutely sure you want to remove this team member from the organization?")) return;

        try {
            const res = await fetch(`/api/organization/members/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (res.ok) {
                this.fetchTeamRoster();
            } else {
                const data = await res.json();
                alert(`Removal Failed: ${data.error || 'Unknown error'}`);
            }
        } catch (e) {
            console.error("Remove Member Error:", e);
        }
    }
}

// Global Launcher
const app = new FeedbackApp();
window.FeedbackAppInstance = app;
