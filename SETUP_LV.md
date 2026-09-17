Automatiska Saatchi Art uz zalans.com sinhronizacija

Sis skripts darbojas TAVA dators (nevis makona serveri), tapec Saatchi Art to neuzskata par robotu un nedrikstetu blokēt.

KO TAS DARA

Katru reizi, kad palaidisi run-sync.bat, skripts paskatas tavu Saatchi Art profila lapu (visus darbus), salidzina ar to, kas jau ir zalans.com datu faila (docs/saatchi.json saja repo), un ja atrod jaunus darbus, tos automatiski pievieno un uzreiz augsupielade (push) uz GitHub. zalans.com tos paradis paris minutu laika.

VIENREIZEJA UZSTADISANA

Solis A. Lejupielade un instale Node.js no https://nodejs.org (izvelies LTS versiju).

Solis B. Saja GitHub repo spied zalo pogu Code, tad Download ZIP, izpako jebkura mape sava datora.

Solis C. Izveido savu GitHub Personal Access Token: ej uz github.com/settings/tokens?type=beta, spied Generate new token, Repository access izvelies Only select repositories un atzime zalans-saatchi-sync, Permissions - Repository permissions - Contents - Read and write, tad izveido tokenu un nokopē to (tas paradisies tikai vienreiz).

Solis D. Izveidotas mapes iekspuse izveido jaunu failu ar nosaukumu token.txt un ielime taja savu tokenu (tikai tokenu, nekas cits). Sis fails nekad netiek augsupieladets uz GitHub.

Solis E. Atver komandrindu (cmd) saja mape un palaid npm install

Solis F. Parbaudei divreiz uzklikskini uz run-sync.bat. Tam vajadzetu atvert melnu logu, kas parada, kas notiek, un pec pabeigsanas aizverties.

AUTOMATISKA PALAISANA, LAI NEKAD NEVAJADZETU PAR TO DOMAT

Atver Windows Task Scheduler (Uzdevumu planotajs). Izvelies Create Basic Task un dod nosaukumu Zalans Saatchi Sync. Trigger sadala izvelies, cik bieži palaist, piemeram Daily. Action sadala izvelies Start a program un noradi celu uz run-sync.bat failu. Pabeidz vedni.

Pec tam skripts pats parbaudis Saatchi Art katru dienu, un ja bus jauns darbs, tas automatiski paradisies zalans.com. Nekas cits nav vajadzigs.

JA KAS NEIZDODAS

Palaizot run-sync.bat, loga paradisies kludas zinojums. Visbiezak tas nozime: trukst token.txt faila vai tas ir tukss, vai tokenam nav pareizo tiesibu (jaatzime Contents Read and write), vai ir interneta savienojuma problema.
