// server.js
const express = require('express');
const admin = require('firebase-admin');
const { OpenAI } = require('openai');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});
const db = admin.database();

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Middleware to verify Firebase ID token
const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ========== KNOWLEDGE BASE CRUD ==========
app.get('/api/knowledge', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  try {
    const snapshot = await db.ref(`users/${userId}/knowledge`).once('value');
    const knowledge = snapshot.val() || {};
    const items = Object.entries(knowledge).map(([id, data]) => ({ id, ...data }));
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/knowledge', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  const { question, answer } = req.body;
  if (!question || !answer) return res.status(400).json({ error: 'Question and answer required' });
  try {
    const newRef = db.ref(`users/${userId}/knowledge`).push();
    await newRef.set({ question, answer, createdAt: Date.now() });
    res.json({ id: newRef.key, question, answer });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/knowledge/:id', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  const { id } = req.params;
  const { question, answer } = req.body;
  try {
    await db.ref(`users/${userId}/knowledge/${id}`).update({ question, answer });
    res.json({ id, question, answer });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/knowledge/:id', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  const { id } = req.params;
  try {
    await db.ref(`users/${userId}/knowledge/${id}`).remove();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== CHAT ENDPOINT (for widget) ==========
app.post('/api/chat', async (req, res) => {
  const { businessId, question, sessionId } = req.body;
  if (!businessId || !question) return res.status(400).json({ error: 'Missing businessId or question' });
  
  try {
    // Fetch knowledge base
    const snapshot = await db.ref(`users/${businessId}/knowledge`).once('value');
    const knowledge = snapshot.val() || {};
    const knowledgeItems = Object.values(knowledge);
    
    if (knowledgeItems.length === 0) {
      const fallbackAnswer = "I don't have any information yet. Please contact support directly.";
      // Save this exchange even if no knowledge
      if (sessionId) {
        await saveMessage(businessId, sessionId, question, fallbackAnswer);
      }
      return res.json({ answer: fallbackAnswer });
    }
    
    // Build context
    let context = `You are a helpful customer support bot. Answer the user's question based on the knowledge base below.
IMPORTANT RULES:
1. If the user's question is not exactly worded, try to infer the intent and match it to the most relevant Q&A pair.
2. Do NOT say "I don't have any information" unless absolutely no related information exists in the knowledge base.
3. If you cannot answer, politely say you don't know and offer to create a support ticket.
4. After providing your answer, ALWAYS ask: "Do you need further assistance?"
5. Keep responses concise, friendly, and helpful.

Knowledge Base:
`;
    knowledgeItems.forEach(item => {
      context += `Q: ${item.question}\nA: ${item.answer}\n\n`;
    });
    
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: context },
        { role: "user", content: question }
      ],
      temperature: 0.7,
      max_tokens: 500
    });
    
    let answer = response.choices[0].message.content;
    if (!answer.toLowerCase().includes("do you need further assistance")) {
      answer += " Do you need further assistance?";
    }
    
    // Save chat message exchange
    if (sessionId) {
      await saveMessage(businessId, sessionId, question, answer);
    }
    
    res.json({ answer });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to get response' });
  }
});

// Helper to save a message exchange
async function saveMessage(businessId, sessionId, userMessage, botResponse) {
  const convRef = db.ref(`users/${businessId}/conversations/${sessionId}`);
  const timestamp = Date.now();
  const messageEntry = {
    userMessage,
    botResponse,
    timestamp
  };
  // Push each exchange as a child under messages array
  const messagesRef = convRef.child('messages').push();
  await messagesRef.set(messageEntry);
  // Also update lastUpdated timestamp on conversation
  await convRef.update({ lastUpdated: timestamp });
}

// ========== GET CONVERSATIONS FOR BUSINESS (dashboard) ==========
app.get('/api/conversations', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  try {
    const snapshot = await db.ref(`users/${userId}/conversations`).once('value');
    const conversations = snapshot.val() || {};
    const result = [];
    for (const [sessionId, data] of Object.entries(conversations)) {
      const messages = data.messages ? Object.values(data.messages) : [];
      result.push({
        sessionId,
        lastUpdated: data.lastUpdated || 0,
        messages: messages.sort((a,b) => a.timestamp - b.timestamp)
      });
    }
    result.sort((a,b) => b.lastUpdated - a.lastUpdated);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== TICKETS ==========
app.post('/api/tickets', async (req, res) => {
  const { businessId, email, question, answer, sessionId } = req.body;
  if (!businessId || !email || !question) return res.status(400).json({ error: 'Missing required fields' });
  try {
    const ticketRef = db.ref(`users/${businessId}/tickets`).push();
    const ticket = {
      email,
      question,
      answerProvided: answer,
      status: 'open',
      createdAt: Date.now(),
      sessionId: sessionId || null
    };
    await ticketRef.set(ticket);
    res.json({ id: ticketRef.key, ...ticket });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tickets', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  try {
    const snapshot = await db.ref(`users/${userId}/tickets`).once('value');
    const tickets = snapshot.val() || {};
    const items = Object.entries(tickets).map(([id, data]) => ({ id, ...data }));
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/tickets/:id', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  const { id } = req.params;
  const { status } = req.body;
  try {
    await db.ref(`users/${userId}/tickets/${id}`).update({ status });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve HTML pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/knowledge', (req, res) => res.sendFile(path.join(__dirname, 'public', 'knowledge.html')));
app.get('/tickets', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tickets.html')));
app.get('/embed', (req, res) => res.sendFile(path.join(__dirname, 'public', 'embed.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));