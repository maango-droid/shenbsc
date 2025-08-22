const http = require('http');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const users = []; // Our in-memory "database"

const server = http.createServer((req, res) => {
    // Handling POST requests for API endpoints
    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            if (req.url === '/api/register') {
                try {
                    const { username, email, password } = JSON.parse(body);
                    
                    if (users.find(user => user.email === email)) {
                        res.writeHead(409, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Email already registered.' }));
                        return;
                    }
                    
                    const hashedPassword = await bcrypt.hash(password, 10);
                    
                    const newUser = { username, email, password: hashedPassword };
                    users.push(newUser);

                    console.log('New user registered:', newUser);
                    
                    res.writeHead(201, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: 'Registration successful!' }));

                } catch (error) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Invalid data.' }));
                }
            } else if (req.url === '/api/login') {
                try {
                    const { email, password } = JSON.parse(body);

                    const user = users.find(u => u.email === email);
                    
                    // Check if user exists and if password is correct
                    if (!user || !(await bcrypt.compare(password, user.password))) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Invalid email or password.' }));
                        return;
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: 'Login successful!', username: user.username }));
                } catch (error) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Invalid data.' }));
                }
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'API Endpoint Not Found.' }));
            }
        });
        return;
    }

    // Handling GET requests for serving static files
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './frontpage.html';
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 Not Found</h1><p>The requested URL was not found on this server.</p>', 'utf-8');
            } else {
                res.writeHead(500);
                res.end(`Server Error: ${error.code}`);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});