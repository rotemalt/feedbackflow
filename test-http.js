const http = require('http');
const server = http.createServer((req, res) => res.end('ok'));
server.listen(4002, () => console.log('http listening'));
