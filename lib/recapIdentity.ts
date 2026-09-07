// ── Telling the model what it is actually looking for ────────────────────────
//
// The ticker is how THIS app addresses an instrument, not how the world writes about it,
// and searching the raw string is why a recap can come back empty on an asset that had a
// loud month. `MIGA.MU` is Strategy Inc's Munich line: no newspaper has ever printed it,
// every story is filed under MSTR. `GC=F` is gold. `^GSPC` is the S&P 500. `EURUSD=X` is
// a currency pair, not a company.
//
// Rather than a mapping table nobody will maintain, the shape of the symbol is decoded
// into a sentence and the model is told to identify the instrument first and search under
// the name it is known by. It knows what MSTR is; it just has to be told that MIGA.MU is
// the same company seen through a different exchange.
export function identityHint(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.startsWith('^')) {
    return 'That ticker is a stock-market INDEX. Report what moved the index and its ' +
      'market — policy, data, big constituents — not one company.';
  }
  if (s.endsWith('=F')) {
    return 'That ticker is a FUTURES contract on a commodity. Report the commodity itself: ' +
      'supply, inventories, OPEC or weather, and the contract roll only if it mattered.';
  }
  if (s.endsWith('=X')) {
    return 'That ticker is an FX PAIR. Report both sides — the central banks, the rate ' +
      'differential, the data that moved either currency.';
  }
  if (s.endsWith('-USD')) {
    return 'That ticker is a CRYPTOCURRENCY against the dollar. Report the protocol, ' +
      'regulation, ETF flows and exchange events.';
  }
  const dot = s.lastIndexOf('.');
  // A Yahoo exchange suffix: .MU Munich, .DE Xetra, .L London, .MI Milan, .PA Paris…
  // Safe on this app's symbols because Yahoo spells share classes with a HYPHEN (BRK-B),
  // never a dot, so a dot here is always an exchange and never a class of stock.
  if (dot > 0 && dot >= s.length - 4) {
    return `That ticker carries the exchange suffix "${s.slice(dot)}", so it is a SECONDARY ` +
      'or foreign listing of a company that is written about under its primary listing and ' +
      'its ordinary name. Identify that company from the name above and search for THAT — ' +
      'news about the Munich or Frankfurt line of a US company does not exist separately, ' +
      'and searching the suffixed ticker will correctly return nothing.';
  }
  return 'That ticker is a listed company. Search under the company name and its main ticker.';
}
