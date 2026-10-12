# Cairn Web (v1.3-web)

Versione web di Cairn per telefono in orizzontale (Kanban, Docs, Roadmap, Whiteboard), già pronta da pubblicare. Non serve nessuna build: è HTML/CSS/JS statico, `index.html` nella radice.

## Pubblicare

**itch.io**
1. Crea un progetto → *Kind of project: HTML*.
2. Carica lo zip con tutto il contenuto di questa cartella (index.html alla radice dello zip) e spunta *This file will be played in the browser*.
3. Embed options: *Viewport* 1280 × 720, *Mobile friendly* attivo, *Orientation* Landscape, *Fullscreen button* attivo.

**GitHub Pages**
1. Copia il contenuto della cartella in un repository (radice o `/docs`).
2. Settings → Pages → *Deploy from a branch* → scegli il branch e la cartella. Il file `.nojekyll` è già incluso.
3. Su iPhone: apri il link in Safari → Condividi → *Aggiungi alla schermata Home* per averla a tutto schermo e offline.

Quando pubblichi una versione nuova, aumenta `VERSION` in `sw.js` (cache offline).

## Telefono ⇄ PC

- **PC → telefono:** comprimi la cartella del progetto (quella con `project.json`) in .zip, poi *Import* nella web app e accedi con lo stesso account/password dell'exe.
- **Telefono → PC:** menu ⋯ → *Export .zip*. Estrai lo zip e copialo sopra la cartella del progetto (con il progetto chiuso nell'exe), oppure apri la cartella estratta con *Open Folder*.

Lo zip contiene esattamente i file dell'exe (`project.json`, `kanban.json`, `accounts.json`, `roadmap.json`, `whiteboards/`, `docs/`, `backups/`): i file che la web app non modifica restano identici byte per byte. Le password usano lo stesso PBKDF2-HMAC-SHA256 (210.000 iterazioni) dell'exe.

## Cosa fa

- Kanban completo: colonne (aggiungi, rinomina, colori per tema, "done", sposta, elimina), card con drag & drop (tieni premuto sul telefono), editor a bozza con priorità, assegnatario, tag, date Due/End/Start/Finish, checklist, sottotask, parent, commenti, activity log, references; archivio, tag, filtri e filtri salvati, backup prima delle eliminazioni.
- Docs: albero di `docs/`, anteprima markdown (wiki link, immagini, tabelle, task list cliccabili), modifica, nuovi documenti/cartelle, rinomina e sposta con aggiornamento dei link, eliminazione nel cestino `docs/.trash`. I `.rtf` sono in sola lettura.
- Roadmap e Whiteboard: sola visualizzazione (pan, zoom, pinch; tocca un elemento per vedere task e documenti collegati).

## Limiti

- I progetti vivono solo nel browser (IndexedDB) del dispositivo: esporta prima di cancellare i dati del browser.
- Non c'è sincronizzazione automatica: se modifichi lo stesso progetto su telefono e PC, l'ultimo zip copiato vince.
- Timer pomodoro e impostazioni avanzate (tipi di milestone, documentation) restano quelli dell'exe.
- Liquid glass: realizzato in CSS (blur + saturazione + riflessi). Le librerie con vera rifrazione usano filtri SVG su `backdrop-filter`, che Safari su iPhone non supporta.

Librerie incluse: JSZip 3.10.1 (MIT), marked 12.0.2 (MIT), DOMPurify 3.1.6 (Apache-2.0/MPL), Ionicons 7.4.0 (MIT).
