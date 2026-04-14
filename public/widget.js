(function() {
    // =============================================
    // Get businessId and color from the script tag URL
    // =============================================
    const script = document.currentScript || 
                   document.querySelector('script[src*="widget.js"]');
    
    if (!script) {
        console.error('Widget: Could not find widget script tag');
        return;
    }

    const scriptUrl = new URL(script.src);
    const BUSINESS_ID = scriptUrl.searchParams.get('businessId');
    const API_BASE = scriptUrl.origin;
    let PRIMARY_COLOR = scriptUrl.searchParams.get('color');

    if (!BUSINESS_ID) {
        console.error('Widget: Missing businessId parameter in script URL');
        console.error('Make sure you are using the embed code from /embed page');
        return;
    }

    // If no color param, try to detect from the page's CSS variables
    if (!PRIMARY_COLOR) {
        // Try to read from :root or body custom properties
        const rootStyles = getComputedStyle(document.documentElement);
        PRIMARY_COLOR = rootStyles.getPropertyValue('--primary-color').trim() ||
                        rootStyles.getPropertyValue('--brand-color').trim();
        // If still empty, check body background color as a fallback? Not reliable.
        if (!PRIMARY_COLOR) {
            PRIMARY_COLOR = '#007bff'; // default blue
        }
    }

    // Helper to darken a hex color for hover effect
    function darkenColor(hex, percent) {
        // Simple darkening for hex colors (supports #RRGGBB)
        if (!hex.startsWith('#')) return hex;
        let r = parseInt(hex.slice(1,3), 16);
        let g = parseInt(hex.slice(3,5), 16);
        let b = parseInt(hex.slice(5,7), 16);
        r = Math.floor(r * (1 - percent/100));
        g = Math.floor(g * (1 - percent/100));
        b = Math.floor(b * (1 - percent/100));
        return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    }
    const HOVER_COLOR = darkenColor(PRIMARY_COLOR, 15);

    console.log('✅ AI Support Widget loaded for business:', BUSINESS_ID, 'with color:', PRIMARY_COLOR);

    // Generate or retrieve session ID for this conversation thread
    const STORAGE_KEY = `ai_support_session_${BUSINESS_ID}`;
    let SESSION_ID = localStorage.getItem(STORAGE_KEY);
    if (!SESSION_ID) {
        SESSION_ID = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem(STORAGE_KEY, SESSION_ID);
    }
    console.log('Session ID:', SESSION_ID);

    // Create widget container with dynamic colors
    const widgetContainer = document.createElement('div');
    widgetContainer.id = 'ai-support-widget';
    widgetContainer.innerHTML = `
        <style>
            #ai-support-widget { 
                position: fixed; 
                bottom: 20px; 
                right: 20px; 
                z-index: 10000; 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                --widget-primary: ${PRIMARY_COLOR};
                --widget-hover: ${HOVER_COLOR};
            }
            .widget-button { 
                background: var(--widget-primary); 
                color: white; 
                border: none; 
                border-radius: 50px; 
                padding: 12px 24px; 
                cursor: pointer; 
                box-shadow: 0 2px 10px rgba(0,0,0,0.2); 
                font-size: 16px; 
                transition: transform 0.2s, background 0.2s; 
            }
            .widget-button:hover { 
                transform: scale(1.05); 
                background: var(--widget-hover); 
            }
            .chat-window { 
                position: fixed; 
                bottom: 80px; 
                right: 20px; 
                width: 350px; 
                height: 500px; 
                background: white; 
                border-radius: 10px; 
                box-shadow: 0 5px 20px rgba(0,0,0,0.2); 
                display: none; 
                flex-direction: column; 
                overflow: hidden; 
                border: 1px solid #ddd; 
            }
            .chat-header { 
                background: var(--widget-primary); 
                color: white; 
                padding: 15px; 
                font-weight: bold; 
                display: flex; 
                justify-content: space-between; 
                align-items: center;
            }
            .chat-close { 
                cursor: pointer; 
                font-size: 24px; 
                line-height: 1;
            }
            .chat-messages { 
                flex: 1; 
                padding: 15px; 
                overflow-y: auto; 
                background: #f8f9fa; 
            }
            .message { 
                margin-bottom: 10px; 
                padding: 8px 12px; 
                border-radius: 8px; 
                max-width: 80%; 
            }
            .user-message { 
                background: var(--widget-primary); 
                color: white; 
                margin-left: auto; 
                text-align: right; 
            }
            .bot-message { 
                background: #e9ecef; 
                color: black; 
            }
            .chat-input-area { 
                display: flex; 
                padding: 10px; 
                border-top: 1px solid #ddd; 
                background: white; 
            }
            .chat-input { 
                flex: 1; 
                padding: 8px; 
                border: 1px solid #ddd; 
                border-radius: 5px; 
                margin-right: 10px; 
            }
            .chat-send { 
                background: var(--widget-primary); 
                color: white; 
                border: none; 
                padding: 8px 15px; 
                border-radius: 5px; 
                cursor: pointer; 
                transition: background 0.2s;
            }
            .chat-send:hover {
                background: var(--widget-hover);
            }
            .satisfaction-buttons { 
                display: flex; 
                gap: 10px; 
                margin-top: 10px; 
            }
            .satisfaction-btn { 
                padding: 5px 15px; 
                border: none; 
                border-radius: 5px; 
                cursor: pointer; 
            }
            .email-input { 
                width: 100%; 
                padding: 8px; 
                margin-top: 10px; 
                border: 1px solid #ddd; 
                border-radius: 5px; 
            }
        </style>
        <button class="widget-button" id="widgetToggleBtn">💬 Need Help?</button>
        <div class="chat-window" id="chatWindow">
            <div class="chat-header">
                <span>Customer Support</span>
                <span class="chat-close" id="chatCloseBtn">×</span>
            </div>
            <div class="chat-messages" id="chatMessages">
                <div class="message bot-message">Hello! How can I help you today?</div>
            </div>
            <div class="chat-input-area">
                <input type="text" class="chat-input" id="chatInput" placeholder="Type your question...">
                <button class="chat-send" id="chatSendBtn">Send</button>
            </div>
        </div>
    `;
    document.body.appendChild(widgetContainer);

    // State variables
    let waitingForFurtherAssistance = false;
    let lastAnswer = '';
    let lastQuestion = '';

    const toggleBtn = document.getElementById('widgetToggleBtn');
    const chatWindow = document.getElementById('chatWindow');
    const closeBtn = document.getElementById('chatCloseBtn');
    const chatMessages = document.getElementById('chatMessages');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('chatSendBtn');

    toggleBtn.addEventListener('click', () => {
        chatWindow.style.display = chatWindow.style.display === 'flex' ? 'none' : 'flex';
    });

    closeBtn.addEventListener('click', () => {
        chatWindow.style.display = 'none';
    });

    function addMessage(text, isUser) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isUser ? 'user-message' : 'bot-message'}`;
        msgDiv.innerText = text;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async function sendToBot(question) {
        addMessage(question, true);
        chatInput.value = '';

        const thinkingMsg = document.createElement('div');
        thinkingMsg.className = 'message bot-message';
        thinkingMsg.innerText = '🤔 Thinking...';
        chatMessages.appendChild(thinkingMsg);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        try {
            const res = await fetch(`${API_BASE}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    businessId: BUSINESS_ID, 
                    question,
                    sessionId: SESSION_ID
                })
            });

            const data = await res.json();
            thinkingMsg.remove();

            const answer = data.answer || data.error || 'Sorry, I could not process your request.';
            addMessage(answer, false);

            lastAnswer = answer;
            lastQuestion = question;
            
            waitingForFurtherAssistance = true;
        } catch (error) {
            thinkingMsg.remove();
            addMessage('Network error. Please try again.', false);
            console.error('Widget fetch error:', error);
        }
    }

    function askSatisfaction() {
        const satisfactionDiv = document.createElement('div');
        satisfactionDiv.className = 'message bot-message';
        satisfactionDiv.innerHTML = `
            <div>Was this answer helpful?</div>
            <div class="satisfaction-buttons">
                <button class="satisfaction-btn" style="background:#28a745;color:white" onclick="window.handleSatisfaction(true)">👍 Yes</button>
                <button class="satisfaction-btn" style="background:#dc3545;color:white" onclick="window.handleSatisfaction(false)">👎 No</button>
            </div>
        `;
        chatMessages.appendChild(satisfactionDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        window.handleSatisfaction = (satisfied) => {
            satisfactionDiv.remove();
            if (!satisfied) {
                askForEmail();
            } else {
                addMessage("Great! I'm glad I could help. Feel free to ask more questions!", false);
            }
        };
    }

    function askForEmail() {
        const emailDiv = document.createElement('div');
        emailDiv.className = 'message bot-message';
        emailDiv.innerHTML = `
            <div>I'm sorry to hear that. Please provide your email address, and our team will contact you shortly.</div>
            <input type="email" class="email-input" id="customerEmail" placeholder="your@email.com">
            <div class="satisfaction-buttons" style="margin-top: 10px;">
                <button class="satisfaction-btn" style="background:${PRIMARY_COLOR};color:white" onclick="window.submitTicket()">Submit</button>
            </div>
        `;
        chatMessages.appendChild(emailDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        window.submitTicket = async () => {
            const email = document.getElementById('customerEmail').value.trim();
            if (!email) {
                alert('Please enter a valid email');
                return;
            }

            try {
                await fetch(`${API_BASE}/api/tickets`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        businessId: BUSINESS_ID,
                        email: email,
                        question: lastQuestion,
                        answer: lastAnswer,
                        sessionId: SESSION_ID
                    })
                });

                emailDiv.innerHTML = '<div>✅ Thank you! A support representative will reach out to you soon.</div>';
            } catch (error) {
                emailDiv.innerHTML = '<div>❌ Error creating ticket. Please try again later.</div>';
                console.error('Ticket error:', error);
            }
            chatMessages.scrollTop = chatMessages.scrollHeight;
        };
    }

    sendBtn.addEventListener('click', async () => {
        const userInput = chatInput.value.trim();
        if (!userInput) return;

        if (waitingForFurtherAssistance) {
            waitingForFurtherAssistance = false;
            const lowerInput = userInput.toLowerCase();
            if (lowerInput === 'no' || lowerInput === 'nope' || lowerInput === 'no thanks' || lowerInput === 'not now') {
                askSatisfaction();
                chatInput.value = '';
            } else {
                addMessage("Sure! What else can I help you with?", false);
                chatInput.value = '';
            }
        } else {
            sendToBot(userInput);
            chatInput.value = '';
        }
    });

    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendBtn.click();
    });
})();