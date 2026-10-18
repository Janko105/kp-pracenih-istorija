# KP praćeni – istorija

Chrome ekstenzija za [KupujemProdajem](https://www.kupujemprodajem.com) koja pamti oglase koje pratiš i pokazuje **koji su nestali** (prodati, obrisani ili istekli). KP sam samo smanji broj praćenih oglasa, bez traga šta je otišlo.

<p>
  <img src="docs/nestali.png" width="400" alt="Tab Nestali">
  <img src="docs/aktivni.png" width="400" alt="Tab Aktivni">
</p>

## Kako radi

- Svaki put kad otvoriš stranicu **Moj KP → Pratim**, ekstenzija pročita listu i uporedi je sa sačuvanom. Oglas kojeg više nema označi kao **nestao**, sa datumom.
- Kad **sam skineš lajk**, ekstenzija to prepozna (prati sajtov poziv `…/unfollow`), pa takav oglas ne prikazuje kao nestao.
- Kad lajkuješ oglas, odmah se upiše sa nazivom.
- Kad je lista na više strana, poređenje se radi tek kad se vide sve strane, da ne bi bilo lažnih nestanaka.
- Na ikonici se prikazuje broj novih nestalih oglasa.
- Podaci se čuvaju samo lokalno (`chrome.storage.local`). Ništa se ne šalje nigde. Izvoz i uvoz u JSON su u meniju ⋮.

Prati se samo veb verzija sajta. Promene napravljene u mobilnoj aplikaciji ekstenzija ne vidi.

## Instalacija

1. Preuzmi repozitorijum (**Code → Download ZIP**, pa raspakuj) ili `git clone`.
2. U Chrome-u otvori `chrome://extensions` i uključi **Developer mode**.
3. Klikni **Load unpacked** i izaberi folder `extension`.
4. Otvori https://www.kupujemprodajem.com/moj-kp/pratim. Oglasi će se pojaviti u popup-u ekstenzije.

Posle izmena koda klikni ↻ na kartici ekstenzije u `chrome://extensions`.

## Struktura

| Fajl | Uloga |
|---|---|
| `extension/content.js` | Čita listu na `/moj-kp/pratim`, poredi je sa sačuvanom, beleži nestale |
| `extension/inject.js` | Radi u kontekstu stranice; javlja kad sajt pošalje `follow` ili `unfollow` |
| `extension/background.js` | Broj novih nestalih oglasa na ikonici |
| `extension/popup.*` | Prikaz (tabovi Nestali i Aktivni, meni za izvoz i uvoz) |
| `test/` | End-to-end testovi (Playwright) na veštačkoj stranici sa izmišljenim oglasima |

## Testovi

Potreban je [Node.js](https://nodejs.org) LTS.

```sh
cd test
npm install
npx playwright install chromium
npm test
```

Testovi pokreću Chromium sa učitanom ekstenzijom i serviraju `test/fixture-pratim.html` umesto pravog sajta.

## Napomene

- Ekstenzija se oslanja na HTML strukturu KP sajta (CSS klase `AdFollow…`, `AdItem…`). Ako KP promeni dizajn, selektore treba ažurirati u `extension/content.js` (objekat `SEL`).
- Font PT Sans je pod licencom SIL Open Font License (`extension/fonts/OFL.txt`).
- Ovo je nezvaničan, lični alat i nije povezan sa KupujemProdajem.
