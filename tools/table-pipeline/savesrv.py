import base64, http.server
class H(http.server.BaseHTTPRequestHandler):
    def _c(self):
        self.send_header('Access-Control-Allow-Origin','*'); self.send_header('Access-Control-Allow-Headers','*')
    def do_OPTIONS(self): self.send_response(200); self._c(); self.end_headers()
    def do_POST(self):
        n=int(self.headers['Content-Length']); d=self.rfile.read(n).decode()
        name=self.path.strip('/'); open('refs/'+name,'wb').write(base64.b64decode(d.split(',',1)[1]))
        self.send_response(200); self._c(); self.end_headers(); self.wfile.write(b'ok')
http.server.HTTPServer(('127.0.0.1',8766),H).serve_forever()
