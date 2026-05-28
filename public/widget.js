/**
 * FeedbackFlow Isolated Widget Engine - Shadow DOM ESM (2026)
 * Secured for maximum browser compatibility across legacy and modern rendering engines.
 */

(function() {
    class FeedbackFlowWidget {
        constructor() {
            this.apiKey = null;
            this.projectConfig = null;
            this.feedbacks = [];
            this.activeTab = 'board'; // 'board', 'submit', 'roadmap'
            this.shadow = null;
            this.container = null;
            
            // Submitter identification hooks
            this.userContext = window.FeedbackFlow || null;

            this.detectApiKey();
            this.initWidget();
        }

        detectApiKey() {
            const scriptTag = document.querySelector('script[data-project-key]');
            if (scriptTag) {
                this.apiKey = scriptTag.getAttribute('data-project-key');
            } else if (document.currentScript && document.currentScript.src) {
                try {
                    const urlParams = new URL(document.currentScript.src).searchParams;
                    this.apiKey = urlParams.get('apiKey');
                } catch (e) {
                    console.warn("FeedbackFlow: Failed to parse currentScript URL query parameters.");
                }
            }
        }

        async initWidget() {
            // Locate or spawn widget parent container
            let container = document.getElementById('feedbackflow-widget-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'feedbackflow-widget-container';
                container.style.position = 'fixed';
                container.style.bottom = '24px';
                container.style.zIndex = '999999';
                document.body.appendChild(container);
            }
            this.container = container;

            // Secure isolated shadow container
            if (!container.shadowRoot) {
                this.shadow = container.attachShadow({ mode: 'open' });
            } else {
                this.shadow = container.shadowRoot;
                this.shadow.innerHTML = ''; // Reset on hot updates
            }

            // Figure out backend host context
            const scriptTag = document.currentScript || document.querySelector('script[src*="widget.js"]');
            this.backendUrl = 'http://localhost:4000';
            if (scriptTag && scriptTag.src) {
                try {
                    const srcUrl = scriptTag.src;
                    if (srcUrl.includes('://')) {
                        // Dynamically extract the exact directory path of the script
                        this.backendUrl = srcUrl.substring(0, srcUrl.lastIndexOf('/'));
                    } else {
                        this.backendUrl = '';
                    }
                } catch(e) {}
            }

            // Load styling stylesheet
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = `${this.backendUrl}/widget.css`;
            this.shadow.appendChild(link);

            // Fetch dynamic Workspace Configs
            if (this.apiKey) {
                await this.loadConfig();
            } else {
                // Seed baseline placeholders
                this.projectConfig = {
                    id: 0,
                    name: 'Demo Workspace',
                    theme_color: '#6366f1',
                    button_position: 'right',
                    welcome_title: 'Feature Requests'
                };
            }

            this.applyPosition();
            this.renderUI();
            this.bindEvents();
        }

        async loadConfig() {
            try {
                const res = await fetch(`${this.backendUrl}/api/widget-config?apiKey=${this.apiKey}`);
                if (res.ok) {
                    this.projectConfig = await res.json();
                }
            } catch (err) {
                console.error("Failed loading FeedbackFlow widget configuration", err);
            }
        }

        applyPosition() {
            const pos = this.projectConfig?.button_position || 'right';
            this.container.style.bottom = '24px';
            if (pos === 'left') {
                this.container.style.left = '24px';
                this.container.style.right = 'auto';
            } else {
                this.container.style.right = '24px';
                this.container.style.left = 'auto';
            }
        }

        renderUI() {
            const themeColor = this.projectConfig?.theme_color || '#6366f1';
            const welcomeTitle = this.projectConfig?.welcome_title || 'Feature Requests';
            
            const wrapper = document.createElement('div');
            wrapper.className = `ff-widget-wrapper ${this.projectConfig?.button_position === 'left' ? 'pos-left' : 'pos-right'}`;
            wrapper.style.setProperty('--accent', themeColor);
            
            wrapper.innerHTML = `
                <div id="ff-panel" class="ff-panel">
                    <div class="ff-header">
                        <h3>${this.escapeHTML(welcomeTitle)}</h3>
                        <p>Help us prioritize what to build next.</p>
                    </div>

                    <div class="ff-nav-tabs">
                        <button class="ff-tab-btn active" data-tab="board">Feedback</button>
                        <button class="ff-tab-btn" data-tab="submit">Submit Request</button>
                        <button class="ff-tab-btn" data-tab="roadmap">Roadmap</button>
                    </div>
                    
                    <div class="ff-body">
                        <!-- View 1: Feedback Board -->
                        <div id="view-board" class="ff-view active">
                            <div class="ff-search-box">
                                <input type="text" id="widget-search" placeholder="Search feature requests...">
                            </div>
                            <div id="feedback-list-mount" class="ff-card-list">
                                <div class="ff-loader"></div>
                            </div>
                        </div>

                        <!-- View 2: Submit Form -->
                        <div id="view-submit" class="ff-view">
                            <form id="widget-submit-form" class="ff-form">
                                <div class="ff-form-group">
                                    <label>Feature Title</label>
                                    <input type="text" id="sub-title" placeholder="Describe the feature in a few words..." required>
                                </div>
                                <div class="ff-form-group">
                                    <label>Category</label>
                                    <div class="ff-radio-group">
                                        <label><input type="radio" name="sub-category" value="feature" checked> Feature</label>
                                        <label><input type="radio" name="sub-category" value="bug"> Bug</label>
                                        <label><input type="radio" name="sub-category" value="improvement"> Improvement</label>
                                    </div>
                                </div>
                                <div class="ff-form-group">
                                    <label>Description</label>
                                    <textarea id="sub-desc" rows="3" placeholder="Why do you need this and what pain does it solve?" required></textarea>
                                </div>

                                <!-- User Info Attributions -->
                                <div id="ff-user-meta-inputs">
                                    <div class="ff-form-group">
                                        <label>Your Name</label>
                                        <input type="text" id="sub-name" placeholder="John Doe">
                                    </div>
                                    <div class="ff-form-group">
                                        <label>Email Address</label>
                                        <input type="email" id="sub-email" placeholder="john@example.com">
                                    </div>
                                </div>

                                <button type="submit" class="ff-btn-submit">Submit Feature Request</button>
                            </form>
                        </div>

                        <!-- View 3: Client Roadmap -->
                        <div id="view-roadmap" class="ff-view">
                            <div class="ff-roadmap-container">
                                <div class="ff-rm-section">
                                    <div class="ff-rm-section-header planned"><span class="ff-rm-dot"></span> Planned</div>
                                    <div id="mount-rm-planned" class="ff-rm-card-list"></div>
                                </div>
                                <div class="ff-rm-section">
                                    <div class="ff-rm-section-header progress"><span class="ff-rm-dot"></span> In Progress</div>
                                    <div id="mount-rm-progress" class="ff-rm-card-list"></div>
                                </div>
                                <div class="ff-rm-section">
                                    <div class="ff-rm-section-header done"><span class="ff-rm-dot"></span> Completed</div>
                                    <div id="mount-rm-done" class="ff-rm-card-list"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="ff-watermark">
                        Powered by <a href="${this.backendUrl}" target="_blank" style="color:var(--accent); text-decoration:none; font-weight:700;">FeedbackFlow</a>
                    </div>
                </div>

                <button id="ff-trigger" class="ff-trigger-btn">
                    <svg class="icon-chat" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                    <svg class="icon-close" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            `;
            
            this.shadow.appendChild(wrapper);
            // Universal selector checks instead of getElementById on ShadowRoot
            this.panel = this.shadow.querySelector('#ff-panel');
            this.trigger = this.shadow.querySelector('#ff-trigger');
            
            // Check identified user context
            this.syncUserContext();
        }

        syncUserContext() {
            this.userContext = window.FeedbackFlow || null;
            if (this.userContext) {
                const metaBlock = this.shadow.querySelector('#ff-user-meta-inputs');
                if (metaBlock) {
                    // Populate and hide inputs since user is pre-identified
                    metaBlock.style.display = 'none';
                    this.shadow.querySelector('#sub-name').value = this.userContext.name || '';
                    this.shadow.querySelector('#sub-email').value = this.userContext.email || '';
                }
            }
        }

        bindEvents() {
            let isOpen = false;

            this.trigger.addEventListener('click', () => {
                isOpen = !isOpen;
                if (isOpen) {
                    this.trigger.classList.add('ff-active');
                    this.panel.classList.add('ff-active');
                    
                    // Re-detect identified user context on trigger click
                    this.syncUserContext();
                    
                    this.fetchFeedback();
                } else {
                    this.trigger.classList.remove('ff-active');
                    this.panel.classList.remove('ff-active');
                }
            });

            // Tabs Selector
            const tabButtons = this.shadow.querySelectorAll('.ff-tab-btn');
            tabButtons.forEach(btn => {
                btn.addEventListener('click', () => {
                    tabButtons.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    
                    const tab = btn.dataset.tab;
                    this.activeTab = tab;
                    
                    const views = this.shadow.querySelectorAll('.ff-view');
                    views.forEach(v => v.classList.remove('ff-active'));
                    
                    const targetView = this.shadow.querySelector(`#view-${tab}`);
                    if (targetView) targetView.classList.add('ff-active');

                    if (tab === 'board' || tab === 'roadmap') {
                        this.fetchFeedback();
                    }
                });
            });

            // Search Filter
            const searchInput = this.shadow.querySelector('#widget-search');
            let debounceTimer;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    this.renderList(e.target.value);
                }, 200);
            });

            // Submit Form
            const form = this.shadow.querySelector('#widget-submit-form');
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                if (!this.projectConfig?.id) {
                    alert("Error: Workspace key matches no active databases.");
                    return;
                }

                const title = this.shadow.querySelector('#sub-title').value;
                const category = this.shadow.querySelector('input[name="sub-category"]:checked').value;
                const description = this.shadow.querySelector('#sub-desc').value;
                
                // Fallback email captures
                const user_name = this.shadow.querySelector('#sub-name').value;
                const user_email = this.shadow.querySelector('#sub-email').value;

                const submitBtn = this.shadow.querySelector('.ff-btn-submit');
                submitBtn.textContent = 'Submitting Request...';
                submitBtn.disabled = true;

                try {
                    const res = await fetch(`${this.backendUrl}/api/feedback`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            project_id: this.projectConfig.id,
                            title,
                            category,
                            description,
                            user_name: user_name || null,
                            user_email: user_email || null
                        })
                    });

                    if (res.ok) {
                        form.reset();
                        this.syncUserContext(); // Re-hide identified accounts
                        
                        // Switch automatically to Board to see your item
                        this.shadow.querySelector('[data-tab="board"]').click();
                    }
                } catch (err) {
                    console.error(err);
                } finally {
                    submitBtn.textContent = 'Submit Feature Request';
                    submitBtn.disabled = false;
                }
            });
        }

        async fetchFeedback() {
            if (!this.projectConfig?.id) return;
            
            try {
                const res = await fetch(`${this.backendUrl}/api/feedback?projectId=${this.projectConfig.id}`);
                if (res.ok) {
                    this.feedbacks = await res.json();
                    
                    if (this.activeTab === 'board') {
                        this.renderList();
                    } else if (this.activeTab === 'roadmap') {
                        this.renderRoadmap();
                    }
                }
            } catch (err) {
                console.error(err);
            }
        }

        renderList(searchQuery = '') {
            const listMount = this.shadow.querySelector('#feedback-list-mount');
            if (!listMount) return;

            let filtered = [...this.feedbacks];
            if (searchQuery) {
                filtered = filtered.filter(f => 
                    f.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                    f.description.toLowerCase().includes(searchQuery.toLowerCase())
                );
            }

            if (filtered.length === 0) {
                listMount.innerHTML = `<div class="ff-empty-state">No matching requests. Be the first to suggest one!</div>`;
                return;
            }

            const votedSet = new Set(JSON.parse(localStorage.getItem('ff_voted') || '[]'));

            listMount.innerHTML = filtered.map(item => {
                const isVoted = votedSet.has(item.id) ? 'voted' : '';
                return `
                    <div class="ff-item-card">
                        <div class="ff-vote-btn ${isVoted}" data-id="${item.id}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 15l-6-6-6 6"/></svg>
                            <span>${item.votes}</span>
                        </div>
                        <div class="ff-item-content">
                            <h4>${this.escapeHTML(item.title)}</h4>
                            <div class="ff-tag-row">
                                <span class="ff-cat-tag ${item.category}">${item.category}</span>
                                ${item.status !== 'none' ? `<span class="ff-status-tag ${item.status}">${item.status}</span>` : ''}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            // Upvoting Event triggers
            listMount.querySelectorAll('.ff-vote-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const id = parseInt(btn.dataset.id);
                    const action = votedSet.has(id) ? 'remove' : 'upvote';

                    // Optimistic update
                    const countSpan = btn.querySelector('span');
                    let count = parseInt(countSpan.textContent);

                    if (action === 'upvote') {
                        btn.classList.add('voted');
                        countSpan.textContent = count + 1;
                        votedSet.add(id);
                    } else {
                        btn.classList.remove('voted');
                        countSpan.textContent = count - 1;
                        votedSet.delete(id);
                    }

                    localStorage.setItem('ff_voted', JSON.stringify([...votedSet]));

                    // Background network post
                    await fetch(`${this.backendUrl}/api/feedback/${id}/vote`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action })
                    });
                });
            });
        }

        renderRoadmap() {
            const mPlanned = this.shadow.querySelector('#mount-rm-planned');
            const mProgress = this.shadow.querySelector('#mount-rm-progress');
            const mDone = this.shadow.querySelector('#mount-rm-done');

            const planned = this.feedbacks.filter(f => f.status === 'planned');
            const progress = this.feedbacks.filter(f => f.status === 'in-progress');
            const done = this.feedbacks.filter(f => f.status === 'done');

            const cardMapper = f => `
                <div class="ff-rm-card">
                    <h5>${this.escapeHTML(f.title)}</h5>
                    <span class="ff-cat-tag ${f.category}">${f.category}</span>
                </div>
            `;

            mPlanned.innerHTML = planned.length > 0 ? planned.map(cardMapper).join('') : `<div class="ff-rm-empty">None scheduled</div>`;
            mProgress.innerHTML = progress.length > 0 ? progress.map(cardMapper).join('') : `<div class="ff-rm-empty">None active</div>`;
            mDone.innerHTML = done.length > 0 ? done.map(cardMapper).join('') : `<div class="ff-rm-empty">None finished</div>`;
        }

        // Exposed API to reload configurations on visual customization sliders changes
        async reconfigure(newApiKey) {
            this.apiKey = newApiKey;
            await this.loadConfig();
            this.applyPosition();
            
            // Re-render UI with active style sheets configurations overrides
            const wrapper = this.shadow.querySelector('.ff-widget-wrapper');
            if (wrapper) {
                wrapper.className = `ff-widget-wrapper ${this.projectConfig.button_position === 'left' ? 'pos-left' : 'pos-right'}`;
                wrapper.style.setProperty('--accent', this.projectConfig.theme_color);
                
                const triggerBtn = this.shadow.querySelector('#ff-trigger');
                if (triggerBtn) triggerBtn.style.backgroundColor = this.projectConfig.theme_color;
                
                const submitBtn = this.shadow.querySelector('.ff-btn-submit');
                if (submitBtn) submitBtn.style.backgroundColor = this.projectConfig.theme_color;

                const headerTitle = this.shadow.querySelector('.ff-header h3');
                if (headerTitle) headerTitle.textContent = this.projectConfig.welcome_title;
            }
        }

        escapeHTML(str) {
            if (!str) return '';
            return str.replace(/[&<>'"]/g, 
                tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
            );
        }
    }

    // Launch instance and bind globally for reconfiguring hooks
    window.FeedbackFlowInstance = new FeedbackFlowWidget();
})();
