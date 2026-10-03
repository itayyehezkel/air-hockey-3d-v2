# Saves the Locker card pictures the game renders in dev with ?bakethumbs (see LockerScene) as WebP files, so the
# shipped game shows them instantly instead of building them from the 3D models.
# Run from the project root:  python3 tools/ui/thumbsrv.py   then open the game with ?bakethumbs, visit the Locker and
# open each tab; when all are saved, move them in:  mv tools/ui/thumbs-out/*.webp src/assets/thumbs/
# (They are staged outside src/: the dev server reloads the page for every new file in src/assets/thumbs.)
import base64, http.server, io, os, re
from PIL import Image

OUT = os.path.join('tools', 'ui', 'thumbs-out')
os.makedirs(OUT, exist_ok=True)


class H(http.server.BaseHTTPRequestHandler):
    def _c(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')

    def do_OPTIONS(self):
        self.send_response(200)
        self._c()
        self.end_headers()

    def do_POST(self):
        name = self.path.strip('/')
        if not re.fullmatch(r'[a-z]+-[a-z0-9]+', name):
            self.send_response(400)
            self._c()
            self.end_headers()
            return
        data = self.rfile.read(int(self.headers['Content-Length'])).decode()
        img = Image.open(io.BytesIO(base64.b64decode(data.split(',', 1)[1]))).convert('RGBA')
        path = os.path.join(OUT, name + '.webp')
        img.save(path, 'WEBP', quality=90, method=6)
        print('saved', path, img.size)
        self.send_response(200)
        self._c()
        self.end_headers()
        self.wfile.write(b'ok')

    def log_message(self, *a):
        pass


http.server.HTTPServer(('127.0.0.1', 8767), H).serve_forever()
