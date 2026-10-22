/* Service worker LOGISTICA — installation (PWA) et usage hors ligne pour Livraison, Transport, Agro et le hub.
   Les pages sont servies réseau d'abord (mises à jour immédiates), cache en secours ; icônes et manifestes : cache d'abord.
   Aucune donnée métier n'est mise en cache ici : elles vivent dans le stockage local de chaque application. */
const V = "logistica-v89";
const COQUE = ["./", "index.html", "parametres.html", "portail.html", "distribution.html", "hub.html", "verifier.html", "livreur.html", "passerelle-config.js", "print-engine.js", "pager-engine.js", "crm.html", "crm-engine.js", "marque.js", "placement.html", "placement-engine.js", "assurance.html", "assurance-engine.js", "shell-engine.js", "modules.css", "auth-engine.js", "sync-engine.js", "roles-engine.js", "qrcode.js", "jsqr.js", "signer.html", "rh-engine.js", "regul-engine.js", "prevision-engine.js", "inter-engine.js", "signal-engine.js", "rapport-engine.js", "etiquette-engine.js",
  "manifest.webmanifest", "manifest-hub.webmanifest", "manifest-vendeur.webmanifest", "manifest-portail.webmanifest", "manifest-livreur.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png",
  "icons/hub-192.png", "icons/hub-512.png", "icons/hub-maskable-512.png", "icons/hub-apple-180.png",
  "icons/vendeur-192.png", "icons/vendeur-512.png", "icons/vendeur-maskable-512.png", "icons/vendeur-apple-180.png",
  "icons/livreur-192.png", "icons/livreur-512.png", "icons/livreur-maskable-512.png", "icons/livreur-apple-180.png",
  ];
self.addEventListener("install", e => {
  // un fichier absent ne doit pas empêcher l'installation : on précharge chaque élément séparément
  e.waitUntil(caches.open(V).then(c => Promise.all(COQUE.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== "angels-partage").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });
const cle = u => { const x = new URL(u); x.search = ""; x.hash = ""; return x.href; };   // le cache ignore les paramètres d'URL
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method === "POST" && u.origin === location.origin && u.searchParams.get("partage") === "1") {   // partage depuis WhatsApp (Web Share Target, Livraison)
    e.respondWith((async () => {
      try {
        const fd = await r.formData(), c = await caches.open("angels-partage"), meta = { text: [fd.get("title"), fd.get("text"), fd.get("url")].filter(Boolean).join("\n"), files: [] };
        let i = 0;
        for (const f of fd.getAll("medias")) {
          if (typeof f === "string") continue;
          const k = "f" + (i++);
          await c.put(new URL("__partage/" + k, self.registration.scope), new Response(f, { headers: { "Content-Type": f.type || "application/octet-stream", "X-Name": encodeURIComponent(f.name || k) } }));
          meta.files.push(k);
        }
        await c.put(new URL("__partage/meta", self.registration.scope), new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
      } catch (x) { /* on ouvre quand même l'application */ }
      return Response.redirect(u.href, 303);   // GET de la même adresse (Livraison ou Espace vendeur)
    })());
    return;
  }
  if (r.method === "GET" && u.href.startsWith("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/")) {   // bibliothèque de connexion de l'application livreur : gardée pour ouvrir hors ligne
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; })));
    return;
  }
  if (r.method !== "GET" || u.origin !== location.origin) return;           // API, cartes, bibliothèques externes : réseau seulement
  if (r.mode === "navigate") {                                              // pages : réseau d'abord, cache de CETTE page en secours
    e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(cle(r.url), cp)); } return res; })
      .catch(async () => (await caches.match(cle(r.url))) || (await caches.match("index.html")) || (await caches.match("distribution.html")) || new Response("Hors ligne", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })));
    return;
  }
  if (/\.(js|json)$/.test(u.pathname)) {                                   // scripts et données (portail-data.js : clés publiques, prix) : réseau d'abord pour ne jamais servir une version périmée
    e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; }).catch(async () => (await caches.match(r, { ignoreSearch: true })) || new Response("", { status: 503 })));
    return;
  }
  e.respondWith(caches.match(r, { ignoreSearch: true }).then(m => m || fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; })));
});

/* Notifications push (Web Push, serveur) et alertes de course : la charge utile est { t: titre, b: texte, tag, u: lien relatif } ;
   un toucher sur la notification rouvre l'application (ou la fenêtre déjà ouverte) à la page voulue. */
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const rel = (e.notification.data && e.notification.data.u) || "livreur.html";
  const cible = new URL(rel, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if (c.url.split("?")[0] === cible.split("?")[0] && "focus" in c) return c.focus(); }
    for (const c of cs) { if ("focus" in c && "navigate" in c) return c.focus().then(w => (w && w.navigate ? w.navigate(cible) : w)); }
    return self.clients.openWindow(cible);
  }));
});
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { t: "LOGISTICA", b: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.t || d.titre || "🏍️ LOGISTICA", { body: d.b || d.corps || "Ouvrez l'application pour répondre.", tag: d.tag || "course", renotify: true, requireInteraction: true, vibrate: [400, 150, 400, 150, 800], icon: "icons/livreur-192.png", badge: "icons/livreur-192.png", data: { u: d.u || "livreur.html" } }));
});
