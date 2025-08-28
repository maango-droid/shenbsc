const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Connect to your database
const db = new sqlite3.Database(path.join(__dirname, 'chat_app.db'), (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        db.serialize(() => {
            db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password TEXT NOT NULL
                );
            `, (err) => {
                if (err) {
                    console.error('Error creating users table:', err.message);
                } else {
                    console.log('Users table created or already exists.');
                }
            });

            db.run(`
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    message TEXT NOT NULL,
                    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                );
            `, (err) => {
                if (err) {
                    console.error('Error creating messages table:', err.message);
                } else {
                    console.log('Messages table created or already exists.');
                }
            });
        });
    }
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 }
}));

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('A user connected via WebSocket');
    socket.on('disconnect', () => {
        console.log('User disconnected from WebSocket');
    });
});

// Message API Routes
app.get('/api/messages', (req, res) => {
    console.log('API /api/messages GET route hit!');
    db.all("SELECT messages.message, users.username, messages.timestamp FROM messages JOIN users ON messages.user_id = users.id ORDER BY messages.timestamp ASC", (err, rows) => {
        if (err) {
            console.error('Error fetching messages from database:', err.message);
            return res.status(500).json({ error: err.message });
        }
        // DEBUG: Log raw timestamps from DB for GET request
        console.log('Raw timestamps from DB (GET /api/messages):', rows.map(row => row.timestamp));
        res.json(rows);
    });
});

app.post('/api/messages', (req, res) => {
    console.log('API /api/messages POST route hit!');
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const { message } = req.body;
    db.run("INSERT INTO messages (user_id, message) VALUES (?, ?)", [req.session.userId, message], function(err) {
        if (err) {
            console.error('Error inserting message into database:', err.message);
            return res.status(500).json({ error: err.message });
        }

        const newMessageId = this.lastID;
        db.get("SELECT users.username, messages.message, messages.timestamp FROM messages JOIN users ON messages.user_id = users.id WHERE messages.id = ?", [newMessageId], (userErr, messageRow) => {
            if (userErr || !messageRow) {
                console.error('Error fetching message details for emission:', userErr ? userErr.message : 'Message details not found');
                return res.status(201).json({ success: true, message: 'Message sent successfully (emission failed)' });
            }
            // DEBUG: Log raw timestamp from DB for POST request before emitting
            console.log('Raw timestamp from DB (POST /api/messages) before emitting:', messageRow.timestamp);
            io.emit('newMessage', { username: messageRow.username, message: messageRow.message, timestamp: messageRow.timestamp });
            res.status(201).json({ success: true, message: 'Message sent successfully' });
        });
    });
});

// Login and Logout routes
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (err) {
            console.error('Login error:', err.message);
            return res.status(500).send('Server error');
        }
        if (!user) {
            return res.status(400).send('Invalid username or password.');
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            req.session.userId = user.id;
            res.redirect('/dashboard.html');
        } else {
            res.status(400).send('Invalid username or password.');
        }
    });
});

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hashedPassword], function(err) {
        if (err) {
            console.error('Registration error:', err.message);
            return res.status(400).send('Username already exists.');
        }
        res.redirect('/login.html');
    });
});

app.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Logout error:', err.message);
            return res.status(500).send('Could not log out.');
        }
        res.redirect('/frontpage.html');
    });
});

// Serve specific HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontpage.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/register.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'register.html'));
});

// Secure Dashboard Route - Dynamically inject username
app.get('/dashboard.html', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login.html');
    }

    db.get("SELECT username FROM users WHERE id = ?", [req.session.userId], (err, userRow) => {
        if (err || !userRow) {
            console.error('Error fetching username for dashboard:', err ? err.message : 'User not found for session');
            return res.status(500).send('Error loading dashboard: User not found.');
        }

        fs.readFile(path.join(__dirname, 'dashboard.html'), 'utf8', (readErr, data) => {
            if (readErr) {
                console.error('Error reading dashboard.html file:', readErr.message);
                return res.status(500).send('Error loading dashboard HTML.');
            }
            const modifiedHtml = data.replace('<!-- USERNAME_PLACEHOLDER -->', `<script>const currentUsername = "${userRow.username}";</script>`);
            res.send(modifiedHtml);
        });
    });
});

// Serve static files for everything else as a last resort.
app.use(express.static(path.join(__dirname, '')));

// Catch-all 404 handler
app.use((req, res, next) => {
    console.warn(`404 Not Found by Express: ${req.method} ${req.originalUrl}`);
    res.status(404).send('<h1>404 - Not Found</h1><p>The requested URL was not found by the application.</p>');
});

// Start the server using the HTTP server instance
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
