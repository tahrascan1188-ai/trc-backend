const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const { initDB, getQuizQuestions, saveGameResult, addInstitution, checkInstitutionLogin, uploadCSVQuestions } = require('./config/google-sheets');

const app = express();
app.use(express.json());
app.use(cors());

const upload = multer({ dest: 'uploads/' });

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {}; // In-memory store for active rooms

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Teacher creates a room
  socket.on('createRoom', async (quizId) => {
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const questions = await getQuizQuestions(quizId || 'default');
    rooms[pin] = { host: socket.id, players: {}, state: 'lobby', currentQuestion: 0, questions };
    socket.join(pin);
    socket.emit('roomCreated', { pin, questions });
    console.log(`Room ${pin} created by host ${socket.id} with ${questions.length} questions`);
  });

  // Student joins a room
  socket.on('joinRoom', ({ pin, nickname }) => {
    if (rooms[pin] && rooms[pin].state === 'lobby') {
      rooms[pin].players[socket.id] = { name: nickname, score: 0, lastAnswer: null };
      socket.join(pin);
      // Notify host
      io.to(rooms[pin].host).emit('playerJoined', rooms[pin].players);
      socket.emit('joinedSuccessfully', pin);
      console.log(`Player ${nickname} joined room ${pin}`);
    } else {
      socket.emit('error', 'Room not found or game already started');
    }
  });

  // Teacher starts the game
  socket.on('startGame', (pin) => {
    if (rooms[pin] && rooms[pin].host === socket.id) {
      rooms[pin].state = 'question';
      io.to(pin).emit('gameStarted');
    }
  });

  // Student submits answer
  socket.on('submitAnswer', ({ pin, answer, timeRemaining }) => {
    if (rooms[pin]) {
      rooms[pin].players[socket.id].lastAnswer = answer;
      const points = Math.round((timeRemaining / 20) * 1000); 
      io.to(rooms[pin].host).emit('playerAnswered', { id: socket.id, answer, points });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    // Cleanup logic can be added here
  });
});

// --- API Routes for SaaS Multi-Tenant ---

// 1. Super Admin: Upload Questions (CSV or XLSX)
app.post('/api/admin/upload-questions', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  
  try {
    // Read the Excel/CSV file using xlsx
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Convert to JSON array of objects
    const results = xlsx.utils.sheet_to_json(sheet);
    
    // Clean up temp file
    fs.unlinkSync(req.file.path);
    
    const success = await uploadCSVQuestions(results);
    if (success) {
      res.json({ message: `Successfully uploaded ${results.length} questions.` });
    } else {
      res.status(500).json({ error: 'Failed to save to Google Sheets' });
    }
  } catch (error) {
    console.error("Parse Error:", error);
    res.status(500).json({ error: 'Failed to parse file' });
  }
});

// 2. Super Admin: Create Institution
app.post('/api/admin/institutions', async (req, res) => {
  const data = req.body;
  data.id = 'INST-' + Math.floor(1000 + Math.random() * 9000);
  const success = await addInstitution(data);
  if (success) {
    res.json({ message: 'Institution created successfully', institution: data });
  } else {
    res.status(500).json({ error: 'Failed to create institution' });
  }
});

// 3. Institution Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (username === 'superadmin' && password === 'superadmin123') {
    return res.json({ role: 'superadmin', name: 'Super Admin' });
  }

  const tenant = await checkInstitutionLogin(username, password);
  if (tenant) {
    res.json({ role: 'tenant', ...tenant });
  } else {
    res.status(401).json({ error: 'Invalid credentials or inactive account' });
  }
});

const PORT = process.env.PORT || 5000;
initDB().then(() => {
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
