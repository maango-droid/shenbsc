const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to your database
const db = new sqlite3.Database(path.join(__dirname, 'chat_app.db'), (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        // Create the users and messages tables if they don't exist
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

// Middleware for parsing request bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session middleware
app.use(session({
    secret: 'your_secret_key', // Replace with a strong, random key
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 } // 1 hour
}));

// *** IMPORTANT: Define API routes BEFORE any other routes or static file serving ***
// This ensures that requests to /api/messages are always handled by these explicit Express routes.

// Message API Routes
app.get('/api/messages', (req, res) => {
    console.log('API /api/messages GET route hit!'); // Debug log to confirm route is reached
    db.all("SELECT messages.message, users.username FROM messages JOIN users ON messages.user_id = users.id ORDER BY messages.timestamp ASC", (err, rows) => {
        if (err) {
            console.error('Error fetching messages from database:', err.message); // Added debug line
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

app.post('/api/messages', (req, res) => {
    console.log('API /api/messages POST route hit!'); // Debug log to confirm route is reached
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const { message } = req.body;
    db.run("INSERT INTO messages (user_id, message) VALUES (?, ?)", [req.session.userId, message], function(err) {
        if (err) {
            console.error('Error inserting message into database:', err.message); // Added debug line
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ success: true, message: 'Message sent successfully' });
    });
});

// Login and Logout routes (These are POST, so they won't conflict with GET static files/HTML routes)
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


// Serve specific HTML files (these must come AFTER API routes to avoid conflicts)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontpage.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/register.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'register.html'));
});

// Secure Dashboard Route
app.get('/dashboard.html', (req, res) => {
    if (req.session.userId) {
        res.sendFile(path.join(__dirname, 'dashboard.html'));
    } else {
        res.redirect('/login.html');
    }
});

// Serve static files for everything else as a last resort.
// This needs to be AFTER all specific routes, including API and explicit HTML files.
app.use(express.static(path.join(__dirname, '')));

// Catch-all 404 handler for any requests not handled by the above routes.
// This will tell us if our Express app is receiving the 404, or if Render's proxy is intercepting.
app.use((req, res, next) => {
    console.warn(`404 Not Found by Express: ${req.method} ${req.originalUrl}`);
    res.status(404).send('<h1>404 - Not Found</h1><p>The requested URL was not found by the application.</p>');
});


// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
