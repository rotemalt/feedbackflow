/**
 * FeedbackFlow - Static Demo Mode API Interceptor
 * 100% In-Browser SaaS & Database Simulation.
 * Intercepts REST API fetches and redirects them to browser localStorage
 * if loaded on GitHub Pages, file:/// protocols, or ?demo=true is present.
 */
(function() {
    const params = new URLSearchParams(window.location.search);
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    
    // Automatically enable demo mode if on GitHub Pages, local files, or forced by query parameter
    const isDemoMode = !isLocalhost || params.get('demo') === 'true' || window.location.hostname.includes('github.io') || window.location.protocol === 'file:';

    if (!isDemoMode) return;

    console.log("💡 FeedbackFlow: Running in Static Demo Mode (API Mock Interceptor active)");

    // Inject a floating alert banner at the top of the body
    window.addEventListener('DOMContentLoaded', () => {
        // Only spawn banner if not inside the widget iframe
        if (window.self !== window.top) return;
        
        const banner = document.createElement('div');
        banner.id = 'ff-demo-banner';
        banner.style.cssText = 'position:fixed; top:0; left:0; right:0; background:linear-gradient(90deg, #6366f1, #818cf8); color:white; font-size:0.75rem; font-weight:700; padding:6px 12px; text-align:center; z-index:99999999; box-shadow:0 2px 10px rgba(0,0,0,0.3); display:flex; justify-content:center; align-items:center; gap:8px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
        banner.innerHTML = `
            <span>💡 Running in Live Static Demo Mode (No backend required. All changes saved to browser memory).</span>
            <button onclick="document.getElementById('ff-demo-banner').remove(); document.body.style.paddingTop='0px';" style="background:rgba(255,255,255,0.25); border:none; color:white; font-weight:bold; cursor:pointer; padding:2px 8px; border-radius:4px; font-size:0.68rem; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.4)'" onmouseout="this.style.background='rgba(255,255,255,0.25)'">Dismiss</button>
        `;
        document.body.appendChild(banner);
        document.body.style.paddingTop = '30px';
    });

    // Mock Database initialization in localStorage
    const initMockDb = () => {
        if (!localStorage.getItem('ff_mock_projects')) {
            localStorage.setItem('ff_mock_projects', JSON.stringify([
                { id: 1, name: "SaaS Live Demo", api_key: "web-app-key-2026", theme_color: "#6366f1", button_position: "right", welcome_title: "Feedback Suggestions" }
            ]));
        }
        if (!localStorage.getItem('ff_mock_feedbacks')) {
            localStorage.setItem('ff_mock_feedbacks', JSON.stringify([
                { id: 1, project_id: 1, title: "Add dynamic dark mode selector", description: "The current dashboard looks amazing, but I want a persistent theme toggle for bright environments.", category: "feature", status: "in-progress", votes: 24, user_name: "Sarah Jenkins", user_email: "sarah@designco.com" },
                { id: 2, project_id: 1, title: "Widget CSS styles override clash", description: "In legacy Safari engines, some styling leaks from parent CSS resets. We should secure root overrides.", category: "bug", status: "planned", votes: 12, user_name: "Marcus Thorne", user_email: "marcus@co.com" },
                { id: 3, project_id: 1, title: "Speed up analytics SVG charts rendering", description: "When filtering thousands of feedback rows, the inline SVG charts have minor repaint delays.", category: "improvement", status: "done", votes: 9, user_name: "Elena Rostova", user_email: "elena@tech.io" },
                { id: 4, project_id: 1, title: "Slack integration webhook sync", description: "It would be great if status updates could dispatch alerts directly to our team Slack channel.", category: "feature", status: "none", votes: 4, user_name: "David Miller", user_email: "david@grow.com" }
            ]));
        }
        if (!localStorage.getItem('ff_mock_comments')) {
            localStorage.setItem('ff_mock_comments', JSON.stringify({
                "1": [
                    { id: 10, author_name: "Sarah Jenkins", author_role: "user", content: "I would love to help design this feature!" },
                    { id: 11, author_name: "Product Manager", author_role: "admin", content: "Great idea Sarah, we have scoped this for our next minor release cycle." }
                ],
                "2": [
                    { id: 20, author_name: "AI Assistant", author_role: "admin", content: "Hi Marcus! Thanks for reporting. Could you share what version of Safari you are running so our engineering team can patch this? Thanks!" }
                ]
            }));
        }
    };
    initMockDb();

    // Helper to mock JSON response
    const mockResponse = (data, status = 200, statusText = 'OK') => {
        return Promise.resolve(new Response(JSON.stringify(data), {
            status,
            statusText,
            headers: { 'Content-Type': 'application/json' }
        }));
    };

    // Override fetch!
    const originalFetch = window.fetch;
    window.fetch = function(url, options = {}) {
        const urlStr = url.toString();
        const method = options.method || 'GET';
        
        // Parse endpoints
        if (urlStr.includes('/api/login')) {
            return mockResponse({ token: 'mock-jwt-token-for-rotemalt-demo' });
        }
        if (urlStr.includes('/api/register')) {
            return mockResponse({ success: true, token: 'mock-jwt-token-for-rotemalt-demo', username: 'admin' });
        }
        if (urlStr.includes('/api/verify')) {
            return mockResponse({ success: true, user: { username: 'admin', id: 1 } });
        }
        if (urlStr.includes('/api/widget-config')) {
            const projects = JSON.parse(localStorage.getItem('ff_mock_projects'));
            return mockResponse(projects[0]);
        }
        if (urlStr.includes('/api/projects')) {
            const projects = JSON.parse(localStorage.getItem('ff_mock_projects'));
            if (method === 'GET') {
                return mockResponse(projects);
            }
            if (method === 'PUT' || method === 'POST') {
                const body = JSON.parse(options.body);
                if (urlStr.includes('/theme')) {
                    projects[0].theme_color = body.theme_color || projects[0].theme_color;
                    projects[0].welcome_title = body.welcome_title || projects[0].welcome_title;
                    projects[0].button_position = body.button_position || projects[0].button_position;
                } else {
                    const newProj = { id: Date.now(), name: body.name, api_key: 'apiKey-' + Math.random().toString(36).substr(2, 9), theme_color: '#6366f1', button_position: 'right', welcome_title: 'Feedback Suggestions' };
                    projects.push(newProj);
                    localStorage.setItem('ff_mock_projects', JSON.stringify(projects));
                    return mockResponse(newProj);
                }
                localStorage.setItem('ff_mock_projects', JSON.stringify(projects));
                return mockResponse({ success: true, ...projects[0] });
            }
        }
        if (urlStr.includes('/api/feedback')) {
            const feedbacks = JSON.parse(localStorage.getItem('ff_mock_feedbacks'));
            
            if (method === 'GET') {
                return mockResponse(feedbacks);
            }
            
            if (method === 'POST') {
                if (urlStr.includes('/vote')) {
                    const parts = urlStr.split('/');
                    const id = parseInt(parts[parts.length - 2]);
                    const card = feedbacks.find(c => c.id === id);
                    const body = JSON.parse(options.body);
                    const modifier = body.action === 'remove' ? -1 : 1;
                    if (card) {
                        card.votes += modifier;
                        localStorage.setItem('ff_mock_feedbacks', JSON.stringify(feedbacks));
                    }
                    return mockResponse({ success: true, id, action: body.action });
                }
                
                if (urlStr.includes('/comments')) {
                    const parts = urlStr.split('/');
                    const id = parseInt(parts[parts.length - 2]);
                    const body = JSON.parse(options.body);
                    
                    const commentsDict = JSON.parse(localStorage.getItem('ff_mock_comments'));
                    if (!commentsDict[id]) commentsDict[id] = [];
                    
                    const newComment = { id: Date.now(), author_name: body.author_name || 'Anonymous User', author_role: body.author_name === 'Product Manager' ? 'admin' : 'user', content: body.content };
                    commentsDict[id].push(newComment);
                    localStorage.setItem('ff_mock_comments', JSON.stringify(commentsDict));
                    return mockResponse(newComment);
                }
                
                const body = JSON.parse(options.body);
                const newFeedback = {
                    id: Date.now(),
                    project_id: body.project_id || 1,
                    title: body.title,
                    description: body.description,
                    category: body.category || 'feature',
                    status: 'none',
                    votes: 1,
                    user_name: body.user_name || 'Anonymous',
                    user_email: body.user_email || ''
                };
                feedbacks.unshift(newFeedback);
                localStorage.setItem('ff_mock_feedbacks', JSON.stringify(feedbacks));

                // --- MOCK AI AGENT REPLY GENERATION ---
                let aiAutoReplied = false;
                if (body.title.length + body.description.length < 35) {
                    aiAutoReplied = true;
                    setTimeout(() => {
                        const commentsDict = JSON.parse(localStorage.getItem('ff_mock_comments'));
                        if (!commentsDict[newFeedback.id]) commentsDict[newFeedback.id] = [];
                        commentsDict[newFeedback.id].push({
                            id: Date.now() + 1,
                            author_name: 'AI Assistant',
                            author_role: 'admin',
                            content: `Hi ${body.user_name || 'there'}! Thanks for writing in. Since FeedbackFlow is running in Static Demo Mode, your request was saved in browser localStorage. To help our mock product team scope this, could you share a bit more detail? Thanks, AI Assistant!`
                        });
                        localStorage.setItem('ff_mock_comments', JSON.stringify(commentsDict));
                    }, 1200);
                }

                return mockResponse({ ...newFeedback, ai_auto_replied: aiAutoReplied });
            }
            
            if (method === 'PUT' && urlStr.includes('/status')) {
                const parts = urlStr.split('/');
                const id = parseInt(parts[parts.length - 2]);
                const body = JSON.parse(options.body);
                const card = feedbacks.find(c => c.id === id);
                if (card) {
                    card.status = body.status;
                    localStorage.setItem('ff_mock_feedbacks', JSON.stringify(feedbacks));
                    
                    if (body.status === 'planned' || body.status === 'in-progress') {
                        setTimeout(() => {
                            const commentsDict = JSON.parse(localStorage.getItem('ff_mock_comments'));
                            if (!commentsDict[id]) commentsDict[id] = [];
                            commentsDict[id].push({
                                id: Date.now() + 2,
                                author_name: 'Developer Tools',
                                author_role: 'admin',
                                content: `System: Synced roadmap transition successfully with GitHub repository. Created mock issue Issue #${Math.floor(Math.random()*800)+100}.`
                            });
                            localStorage.setItem('ff_mock_comments', JSON.stringify(commentsDict));
                        }, 500);
                    }
                }
                return mockResponse({ success: true, id, status: body.status });
            }
        }
        
        if (urlStr.includes('/comments') && method === 'GET') {
            const parts = urlStr.split('/');
            const id = parts[parts.length - 2];
            const commentsDict = JSON.parse(localStorage.getItem('ff_mock_comments'));
            return mockResponse(commentsDict[id] || []);
        }

        if (urlStr.includes('/api/analytics')) {
            const feedbacks = JSON.parse(localStorage.getItem('ff_mock_feedbacks'));
            const bugs = feedbacks.filter(f => f.category === 'bug').length;
            const features = feedbacks.filter(f => f.category === 'feature').length;
            const improvements = feedbacks.filter(f => f.category === 'improvement').length;

            const planned = feedbacks.filter(f => f.status === 'planned').length;
            const progress = feedbacks.filter(f => f.status === 'in-progress' || f.status === 'progress').length;
            const done = feedbacks.filter(f => f.status === 'done').length;

            const votes = feedbacks.reduce((acc, curr) => acc + curr.votes, 0);

            return mockResponse({
                total_feedbacks: feedbacks.length,
                total_votes: votes,
                category_distribution: { feature: features, bug: bugs, improvement: improvements },
                status_distribution: { none: feedbacks.length - planned - progress - done, planned, progress, done },
                monthly_trend: [
                    { month: 'May', count: feedbacks.length }
                ]
            });
        }
        
        return originalFetch(url, options);
    };
})();
