# One More Floor

**Jeszcze jedno piętro.** Szybki roguelike / arcade dungeon crawler na telefon, zrobiony jako prawdziwa PWA (instalowalna, działa offline). Bez backendu, bez build stepu, bez zewnętrznych assetów: HTML + CSS + Canvas 2D + Web Audio.

## Jak się gra

- **Ruch:** przeciągnij palcem w dowolnym miejscu ekranu (pływający joystick). Na komputerze działa WASD / strzałki.
- **Strzał:** automatyczny, w najbliższego widocznego wroga.
- **DASH:** przycisk w rogu, tap drugim palcem albo Spacja/Shift. Na czas dasha jesteś nietykalny. Jeśli przelecisz przez atak, liczy się to jako **idealny unik** (spowolnienie czasu, synergia z „Adrenaliną”).
- **Pętla:** walka, nagroda (1 z 3 ulepszeń), wybór drzwi (Walka / Elita / Odpoczynek), następne piętro. **Boss co 5 pięter.**
- Po śmierci dostajesz **odłamki**, które wydajesz w **Warsztacie** na trwałe ulepszenia i odblokowania.

### Buildy

Każde ulepszenie ma tag, a losowanie kart lekko preferuje tagi, które już zbierasz, więc build układa się sam:

| Tag | Styl | Przykłady |
|---|---|---|
| SALWA | ilość pocisków | Rozdzielacz, Rykoszet, Tylna Straż, Chip Naprowadzający |
| PRECYZJA | crit / snajper | Soczewka, Egzekutor, Ciężkie Kule, Szklane Działo |
| ŻYWIOŁ | efekty | Cewka Łukowa, Żar, Kriopociski, Niestabilność |
| ZRYW | dash | Dopalacz, Podwójny Zryw, Nova Zrywu, Adrenalina |
| PANCERZ | przetrwanie | Egida, Aureola Ostrzy, Naprawiacz, Pijawka |

### Bossowie (każdy ma własną mechanikę do nauczenia)

1. **Strażnik Wieży** (piętro 5): spirale pocisków, skoki ze slamem (obserwuj czerwony krąg i cień, cel zamyka się tuż przed lądowaniem), wachlarze.
2. **Krosno** (piętro 10): obracające się lasery (strzałki na zapowiedzi pokazują kierunek obrotu), siatki laserów, naprowadzające kule, które można zestrzelić.
3. **Lustro** (piętro 15): rozdziela się na kopie. **Tylko prawdziwe ma pełny, biały rdzeń**, a rozbita kopia wystrzeliwuje pierścień pocisków. Do tego szarże od ściany do ściany, które zostawiają ślady pocisków, oraz przywoływanie wrogów.

Od piętra 20 bossowie wracają w wersji **II** (więcej HP, od razu w fazie furii). Poniżej 50% HP każdy boss wchodzi w **fazę furii**.

### Progresja trwała (Warsztat)

Ulepszenia są celowo skromne: +3 HP, +25% obrażeń, przelosowania, jedno „drugie życie”. Dochodzi do tego 5 schematów, które odblokowują epickie ulepszenia, czyli dają nowe buildy, a nie surową siłę. Umiejętności nadal decydują.

### Pod krótkie sesje

- Szybki restart jednym tapem („JESZCZE RAZ”).
- Rekordy lokalne: najwyższe piętro, najwięcej zabójstw, historia ostatnich runów.
- Ekran śmierci pokazuje, ile brakowało do rekordu i na co stać Cię w Warsztacie.
- **Kontynuacja:** stan runu zapisuje się na początku każdego piętra, więc zamknięcie aplikacji nie kasuje postępu (przycisk „KONTYNUUJ” w menu).

## Uruchomienie lokalne

Gra to zwykłe pliki statyczne. Najprościej:

```bash
# dowolny serwer statyczny, np.:
python3 -m http.server 8080
# potem otwórz http://localhost:8080/
```

albo z symulacją podkatalogu jak na GitHub Pages:

```bash
node tools/serve.js 8080 /One-More-Floor/
# http://localhost:8080/One-More-Floor/
```

Samo `index.html` otwarte z dysku (`file://`) też działa, bo skrypty są klasyczne, nie moduły ES. Service worker i instalacja PWA wymagają jednak HTTP(S) albo `localhost`.

Na telefonie w tej samej sieci Wi-Fi otwórz `http://<IP-komputera>:8080/`. Do instalacji PWA potrzebne jest HTTPS, więc najłatwiej przez GitHub Pages.

## Publikacja na GitHub Pages

Wszystkie ścieżki są **względne** (`./sw.js`, `icons/...`, `start_url: "./"`, `scope: "./"`), więc gra działa pod `https://<user>.github.io/<nazwa-repozytorium>/` bez żadnych zmian.

**Opcja A: z gałęzi (najprostsza)**
1. Wypchnij pliki do gałęzi `main`.
2. W repozytorium: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Wybierz `main` i folder `/ (root)`, potem Save.
4. Po chwili gra będzie pod `https://<user>.github.io/<repo>/`.

**Opcja B: GitHub Actions** (workflow jest w `.github/workflows/pages.yml`)
1. **Settings → Pages → Source: GitHub Actions**.
2. Każdy push do `main` publikuje tylko pliki gry (bez `tools/`).

Plik `.nojekyll` wyłącza przetwarzanie przez Jekyll.

### Instalacja na telefonie
- **Android / Chrome:** menu → „Zainstaluj aplikację” (albo przycisk w menu gry).
- **iOS / Safari:** Udostępnij → „Do ekranu początkowego”.

Po pierwszym uruchomieniu wszystkie pliki są w cache, więc gra działa **offline**.

### Aktualizacja wersji
Przy każdej publikacji zmian podbij `CACHE_VERSION` w `sw.js` (i `APP_VERSION` w `js/main.js`). Stary cache zostanie usunięty, a nowa wersja załaduje się przy kolejnym uruchomieniu.

## Struktura

```
index.html              ekrany UI + HUD, ładuje skrypty
manifest.webmanifest    manifest PWA (ścieżki względne)
sw.js                   service worker (precache + offline)
css/style.css           style, mobile-first, safe-area, landscape
js/util.js              matematyka, kolizje
js/data.js              wrogowie, ulepszenia, Warsztat, bossowie, krzywa trudności
js/save.js              zapis w localStorage
js/audio.js             SFX + generatywna muzyka (Web Audio)
js/input.js             joystick dotykowy, dash, klawiatura
js/fx.js                stan gry, cząsteczki, shake, hitstop, slow-mo, jakość
js/world.js             arena, filary, drzwi, linia wzroku
js/entities.js          gracz, pociski, wrogowie, obrażenia, pickupy
js/bosses.js            3 bossów z wzorcami ataków
js/game.js              przebieg runu i pięter, nagrody, śmierć, rekordy
js/render.js            renderer Canvas 2D
js/ui.js                ekrany DOM
js/main.js              pętla (stały krok 60 Hz), cykl życia, rejestracja SW
tools/                  serwer deweloperski, audyty Playwright, generator ikon
```

## Wydajność

- Symulacja w stałym kroku 60 Hz, render w `requestAnimationFrame`, maks. 5 kroków na klatkę.
- Pule obiektów dla pocisków i cząsteczek, twarde limity (pociski, cząsteczki, wrogowie).
- Podłoga pre-renderowana raz na pokój; glow jako cache'owane sprite'y; pociski wroga jako 1 `drawImage` (albo jedna ścieżka w niskiej jakości).
- **Auto-jakość:** jeśli średnia klatka spada poniżej ~45 FPS, gra obniża DPR, liczbę cząsteczek i glow (tylko w dół, bez oscylacji). Jakość można też ustawić ręcznie.
- Gra pauzuje się, a dźwięk zawiesza, gdy karta/aplikacja przechodzi w tło.

## Testy / audyt

```bash
npm i -D playwright     # albo globalny playwright z Chromium
npm run serve &         # serwer pod /One-More-Floor/
npm run audit           # boty grają runy (uczciwie i w god-mode do piętra 31), inwarianty, błędy JS
npm run audit:ui        # 5 profili urządzeń: dotyk, dash, pauza, nagrody, drzwi, bossowie,
                        # śmierć, restart, Warsztat, ustawienia, kontynuacja, manifest, SW, offline
npm run perf            # koszt klatki przy 4x spowolnionym CPU
```

Tryb debug: dopisz `?debug` do URL, wtedy `window.OMF` wystawia stan gry.
