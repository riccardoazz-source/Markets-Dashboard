# Rotation Model — Version History & Backtest Log

> **La tabella viva è ora DENTRO l'app**, sotto il pannello Backtest (sezione
> espandibile "📊 Versioni del modello & risultati backtest"). La riga del
> modello attuale si auto-compila dall'ultimo backtest lanciato. Il registro dati
> è in `lib/modelVersions.ts`.
>
> **RESTART (Modello 1)**: abbiamo azzerato la numerazione. Il "Modello 1" è la
> formula attuale; da qui ogni cambio incrementa (Modello 2, 3, …). La cronologia
> git qui sotto (v1–v5.2) è solo archeologia di come ci siamo arrivati.

## Come iteriamo

1. Lanci il backtest nell'app → la riga del Modello attuale si compila da sola
2. Quando cambiamo formula: congelo i risultati del modello attuale in
   `lib/modelVersions.ts` (current:false) e aggiungo il nuovo come current:true
3. Il Reliability ratio si ricalcola da solo e marca il "★ best"

---

## Archeologia (git history — pre-restart)

Ogni volta che cambiamo la formula del modello:
1. Si aggiunge una riga nella tabella dei risultati con la versione precedente
2. Si descrive la nuova versione nella sezione Formule
3. Dopo aver eseguito il backtest nell'app, si aggiornano i valori nella tabella

**Reliability Ratio** — misura quanto ci si può fidare di una versione. Due principi:

1. **Priorità alla cattura dei winner reali** — quanti dei top performer effettivi
   del periodo il modello ha preso (non solo "ha battuto SPX").
2. **Penalità asimmetrica per orizzonte** quando va sotto S&P 500:
   - 1D sotto SPX → non muore nessuno (severità 0.2)
   - 1M sotto SPX → accettabile (severità 0.6)
   - 5Y sotto SPX → spazzatura (severità 5.0, affossa il punteggio)

```
alpha_p     = basket_p − spx_p
effAlpha_p  = alpha_p ≥ 0 ? alpha_p : alpha_p × lossSeverity_p
WeightedAlphaEff = Σ w_p · effAlpha_p / Σ w_p
CaptureRate = Σ w_p · (winnerHits_p / winnerTotal_p) / Σ w_p
PickFactor  = min(1, AvgPicks / 6)
qualityMult = (0.35 + 0.65 · CaptureRate) · PickFactor

Reliability = WeightedAlphaEff ≥ 0
              ? WeightedAlphaEff × qualityMult        (modello buono)
              : WeightedAlphaEff × (2 − qualityMult)  (modello scarso → peggiora)
```

- **Pesi orizzonte** w_p: 1D=5%, 1M=10%, 3M=20%, 6M=20%, 1Y=25%, 5Y=20%
- **lossSeverity** (solo se alpha<0): 1D=0.2, 1M=0.6, 3M=1.0, 6M=1.5, 1Y=2.5, 5Y=5.0
- **CaptureRate** è la leva prioritaria: catturare i winner reali scala il punteggio
  da 0.35× (nessuno) a 1.0× (tutti). Senza dati di cattura → neutro (1.0).

Cattura alta + batte SPX (soprattutto a lungo) + molti picks → Reliability alta.
Una sola sottoperformance a 5Y → Reliability negativa = spazzatura.

---

## Tabella Backtest

> **Come leggere**: ogni colonna di periodo (1D, 1M…) mostra `Basket % | SPX % | N picks`.
> Le celle con `?` indicano dati non ancora rilevati.

| Versione | 1D | 1M | 3M | 6M | 1Y | 5Y | α pesato | Hit Rate | Avg Picks | Reliability |
|---|---|---|---|---|---|---|---|---|---|---|
| v1 — RotationScore base | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| v2 — Pace ladder | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| v3 — Dual blow-off + r1m cap | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| v4 — EXT commodity-aware | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| v5.0 — 3-horizon + VOL | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| v5.1 — aLong brake + regime gate | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| **v5.2 — SHA in TRD + lastClose** | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |

---

## Formule per versione

### v1 — RotationScore base
`commit 6716461`

```
Score = ACC_pctile        (percentile di accelerazione grezza)
Gate:  r1m > 0 AND r3m > 0
Picks: top 8 per score
```

Primo tentativo. Nessun blow-off guard, nessun EXT.

---

### v2 — Pace ladder
`commit 4820e87`

```
p1 = r1m
p3 = ((1+r3m/100)^(1/3) - 1) × 100
aRecent = p1 - p3

Score = 0.60·ACC + 0.40·TRD - 0.20·EXT
  ACC = percentile(aRecent)
  TRD = percentile(r3m)
  EXT = percentile(stretch)  dove stretch = max(0, price/MA200-1)×100 / vol

Gate:  r1m > 0 AND r3m > 0 AND aRecent > 0
Picks: top 8
```

Introduce il concetto di blow-off guard via stretch vs MA200.

---

### v3 — Dual blow-off guard + r1m cap
`commit f24de13`

```
EXT = max(STRETCH_pctile, R1M_ABS_pctile)
  STRETCH = max(0, price/MA200-1)×100 / vol
  R1M_ABS = |r1m|   (cattura anche spike senza MA200 data)

Gate aggiunge: r1m < 50%  (cap blow-off mensile)
```

Il guard duale cattura sia "prezzo distante da MA200" che "mese esplosivo".

---

### v4 — EXT commodity-aware
`commit df28c46`

```
wEXT = 0.32 per Commodities (vs 0.20 default)
Cap r1m commodities = 25% (vs 50% default)

Motivazione: Silver +41%→-15%, Palladium +39%→-37%, WTI +44%→-25%
             Le commodity pops mean-revertono più forte degli equity.
```

---

### v5.0 — 3-horizon + VOL
`commit c012520`

```
p6  = ((1+r6m/100)^(1/6) - 1) × 100
p1y = ((1+r1y/100)^(1/12) - 1) × 100
aBuild = p3 - p6
aLong  = p6 - p1y

ACCEL = 0.50·aRecent + 0.30·aBuild + 0.20·aLong    (full 3-horizon)
      = 0.60·aRecent + 0.40·aBuild                  (fallback se r1y mancante)

Score = 0.45·ACC + 0.25·TRD + 0.10·REG + 0.04·VOL - wEXT·EXT
  TRD = p3m_pctile
  REG = 1.0 se price > MA200, 0.5 se MA dati mancanti, 0.2 se sotto
  VOL = percentile(latestVol / avg20dVol),  null → 0.5
```

---

### v5.1 — aLong come freno + regime gate
`commit 451761a`

```
ACCEL = 0.55·aRecent + 0.35·aBuild + 0.20·min(0, aLong)
  → aLong è solo un freno: se p6<p1y (trend in scadenza) penalizza,
    ma una pop su base piatta NON riceve bonus (fix commodity pops)

Gate aggiunge: price >= MA200
  → Filtra asset che salgono ancora sotto la MA200 (momentum falso)
  → Se MA200 mancante (asset nuovo) → non escluso
```

---

### v5.2 — SHA in TRD + lastClose per regime gate  ← **VERSIONE ATTUALE**
`commit 50a1133`

```
SHA = r3m / monthlyVol    (risk-adjusted momentum, Sharpe-like)

TRD = 0.50·p3m + 0.20·p6m + 0.30·pSharpe
  pSharpe = percentile(SHA) solo tra asset con vol disponibile
  null-vol → 0.5 neutro (backtest non influenzato)

Regime gate usa lastClose (chiusura giornaliera) invece del prezzo
intraday → allineamento con il backtest, riduce divergenza 1D.

Score = 0.45·ACC + 0.25·TRD + 0.10·REG + 0.04·VOL − wEXT·EXT

Gate invariato: r1m>0 ∧ r3m>0 ∧ aRecent>0 ∧ r1m<cap ∧ lastClose≥MA200
```

**SHA** premia trend smooth a bassa volatilità vs spike dello stesso ritorno lordo.

---

## Segnali disponibili non ancora nel modello

| Segnale | Disponibile in backtest? | Note |
|---|---|---|
| `pos52w` — posizione nel range 52 settimane | Sì (calcolabile da history) | 0% = sui minimi 52W, 100% = sui massimi |
| `sma200w` — MA 200 settimane | No (troppo costoso calcolare 4Y di dati weekly) | Solo display, non usato nel score |
| REG graduale | Sì | Invece di binario, usare `(price/MA200-1)` normalizzato |
| Trend consistency | Sì (da history) | Quante settimane positive negli ultimi 3M? |

---

## Prossimi esperimenti da testare

Appena il backtest della v5.2 è disponibile, valutare:

1. **REG graduale** — sostituire il binario 1.0/0.2 con percentile di `(price/MA200 - 1)`.
   Cattura "quanto sopra" non solo "sì/no".

2. **pos52w come segnale** — aggiungere la posizione nel range 52W come componente di TRD o REG.
   Asset vicino ai massimi 52W + accelerazione = breakout confermato.

3. **Semplificare ACC** — tornare a 2-horizon (aRecent + aBuild) se i risultati di v5.1→v5.2
   non migliorano con aLong. Meno parametri = meno overfitting.

4. **Backtest walk-forward** — invece di 6 scenari fissi, campionare 50+ date casuali
   negli ultimi 5 anni per avere statistiche robuste invece di 6 punti singoli.
