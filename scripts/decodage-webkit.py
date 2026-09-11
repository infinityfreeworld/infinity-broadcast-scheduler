#!/usr/bin/env python3
"""
Décode des fichiers audio dans le WebKit SYSTÈME de ce Mac — celui de
Safari ET de l'application native (WKWebView) — et dit lesquels passent.

Pourquoi cet outil existe : « Decoding failed » ne se reproduit ni dans
Chrome, ni dans ffmpeg, ni dans aucun test Node. Le 11/09/2026, toutes les
émissions (Ogg/Opus) étaient muettes sous WebKit alors que tous les autres
outils les lisaient parfaitement.

Usage (uv télécharge PyObjC la première fois) :
  uv run --python 3.12 --with pyobjc-framework-WebKit \\
      scripts/decodage-webkit.py emission.webm autre.ogg

Décode en 8 kHz mono (OfflineAudioContext) : une émission de 28 min tient
en ~54 Mo au lieu de ~320 Mo à 48 kHz — ce Mac n'a que 8 Go.

Code de sortie : 0 si TOUS les fichiers se décodent, 1 sinon.
"""
import base64, json, os, platform, sys
import objc
from Foundation import NSObject, NSURL, NSRunLoop, NSDate
from AppKit import NSApplication
from WebKit import WKWebView, WKWebViewConfiguration

PAGE = """<!doctype html><meta charset=utf-8><script>
const out = m => window.webkit.messageHandlers.out.postMessage(String(m));
(async () => {
  const nom = %s, b64 = %s;
  try {
    const ab = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
    let ctx;
    for (const r of [8000, 22050, 44100]) { try { ctx = new OfflineAudioContext(1, 1, r); break } catch (e) {} }
    const buf = await ctx.decodeAudioData(ab);
    out('OK ' + nom + ' : ' + (buf.duration / 60).toFixed(1) + ' min décodées');
  } catch (e) { out('ECHEC ' + nom + ' : ' + (e && (e.message || e.name))); }
  out('FIN');
})();
</script>"""

fichiers = sys.argv[1:]
if not fichiers:
    print(__doc__)
    sys.exit(2)

etat = {'i': 0, 'echecs': 0, 'limite': None}

def charger(i):
    chemin = fichiers[i]
    b64 = base64.b64encode(open(chemin, 'rb').read()).decode()
    html = PAGE % (json.dumps(os.path.basename(chemin)), json.dumps(b64))
    vue.loadHTMLString_baseURL_(html, NSURL.URLWithString_('https://infinity-freeworld.com/'))
    etat['limite'] = NSDate.dateWithTimeIntervalSinceNow_(180)

class Sortie(NSObject, protocols=[objc.protocolNamed('WKScriptMessageHandler')]):
    def userContentController_didReceiveScriptMessage_(self, controleur, message):
        s = str(message.body())
        if s == 'FIN':
            etat['i'] += 1
            if etat['i'] >= len(fichiers):
                os._exit(1 if etat['echecs'] else 0)
            charger(etat['i'])
            return
        if s.startswith('ECHEC'):
            etat['echecs'] += 1
        print('  ' + ('✅ ' if s.startswith('OK') else '🔴 ') + s.split(' ', 1)[1], flush=True)

print(f'  WebKit système — macOS {platform.mac_ver()[0]}', flush=True)
NSApplication.sharedApplication().setActivationPolicy_(2)
cfg = WKWebViewConfiguration.alloc().init()
sortie = Sortie.alloc().init()
cfg.userContentController().addScriptMessageHandler_name_(sortie, 'out')
vue = WKWebView.alloc().initWithFrame_configuration_(((0, 0), (10, 10)), cfg)
charger(0)
while True:
    NSRunLoop.currentRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(0.2))
    if NSDate.date().compare_(etat['limite']) > 0:
        print(f'  🔴 {os.path.basename(fichiers[etat["i"]])} : aucune réponse en 180 s', flush=True)
        os._exit(1)
