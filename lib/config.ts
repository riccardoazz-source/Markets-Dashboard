import { AssetConfig } from './types';

export type MacroUnit = '%' | 'K' | 'idx' | 'B$' | '$' | 'EH/s';
export type MacroCategory = 'Rates' | 'Employment' | 'Inflation' | 'Growth' | 'Real Estate' | 'Money' | 'Commodities' | 'Currency' | 'Sentiment' | 'Crypto' | 'Debt' | 'Market Value' | 'Recessions' | 'Events';

// ---------- Source metadata ----------
// Each MacroIndicator declares its primary data source.
// The API route dispatches fetches based on `source.type`; adding a new
// indicator that uses an existing type requires only a new entry here, no
// changes to the route code.
export type MacroSourceType =
  | 'fred'         // FRED / DBnomics mirror (series id == indicator id unless overridden)
  | 'ecb'          // ECB Data Portal (ECBDFR deposit facility rate)
  | 'bls'          // Bureau of Labor Statistics
  | 'treasury'     // US Treasury yield-curve CSV
  | 'fomc'         // Federal Reserve FOMC rate decisions (hardcoded table + FRED fallback)
  | 'yahoo_price'  // Yahoo Finance price series — symbol required
  | 'yahoo_ratio'  // Yahoo Finance: price(numerator) / price(denominator)
  | 'multpl'       // multpl.com valuation tables (via reader proxy) — slug required
  | 'computed';    // computed server-side in the API route (Bitcoin halving, RSI, miner revenue)

export interface MacroSource {
  type: MacroSourceType;
  label: string;        // Human-readable provider name shown in Sources tab
  url: string;          // Deep-link to the indicator's page at the source
  symbol?: string;      // yahoo_price only
  numerator?: string;   // yahoo_ratio only: top symbol
  denominator?: string; // yahoo_ratio only: bottom symbol
  slug?: string;        // multpl only: path slug at multpl.com
}

export interface MacroIndicator {
  id: string;
  name: string;
  category: MacroCategory;
  unit: MacroUnit;
  source: MacroSource;
}

// ---------- Market Events ----------
// 'personal' has no built-in events — it's reserved for the user's own dates
// added from the Sources tab.
export type MarketEventCategory = 'financial' | 'war' | 'terrorism' | 'pandemic' | 'geopolitical' | 'elections' | 'crypto' | 'ipo' | 'personal';

export interface MarketEvent {
  date: string;               // YYYY-MM-DD
  label: string;              // Short display name for the chart line
  description: string;        // Tooltip / longer description
  category: MarketEventCategory;
  source?: string;            // Verifiable reference URL (REQUIRED for every NEW event — see EVENTS.md)
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT INCLUSION BAR — "strict / landmark only". Read this before adding ANY
// event. Full update protocol (verify → preview → approve → commit) is in
// EVENTS.md at the repo root. Two hard rules:
//   1. VERIFY: every date must be confirmed against a reputable source at
//      add-time and carry a `source` URL. If a concrete date can't be verified,
//      DO NOT add it — report "can't verify" instead of guessing.
//   2. QUALIFY: the event must clear its category bar below. When unsure, leave
//      it out. Curated history is a highlight reel, not a log.
//
//   financial    Systemic crises or broad-market single-day shocks (index
//                crash / circuit breaker, systemic-institution failure,
//                sovereign or credit shock). Not routine corrections.
//   war          Outbreak of a major armed conflict with global/market impact,
//                or a decisive escalation. Not individual battles/strikes.
//   terrorism    Mass-casualty attacks with market or geopolitical significance.
//   pandemic     WHO-level declarations (PHEIC / pandemic) or epidemic peaks of
//                global impact.
//   geopolitical Referendums, treaties, leadership changes or policy shocks of
//                landmark, era-defining significance (Cold War turning points,
//                EU formation, trade-war milestones). Not routine politics.
//   elections    US presidential and midterm elections — Election Day (first
//                Tuesday after the first Monday in November). Pure calendar facts.
//   crypto       Protocol-level milestones, top-exchange/stablecoin failures,
//                landmark regulatory or adoption firsts, or major cycle ATHs.
//   ipo          COMPLETED listings only. Raise ≥ ~$2B OR a landmark debut
//                (first-of-kind, mega-cap, cultural milestone). Never private
//                or merely rumored companies.
//   personal     User-defined. No bar — the user owns this category.
// ─────────────────────────────────────────────────────────────────────────────

export const MARKET_EVENT_COLORS: Record<MarketEventCategory, string> = {
  financial:   '#dc2626', // red
  war:         '#ea580c', // orange-red
  terrorism:   '#f97316', // orange
  pandemic:    '#9333ea', // purple
  geopolitical:'#3b82f6', // blue
  elections:   '#f59e0b', // amber — US presidential elections
  crypto:      '#0891b2', // cyan
  ipo:         '#16a34a', // green — market debuts / listings
  personal:    '#ec4899', // pink — user's own events
};

export const MARKET_EVENTS: MarketEvent[] = [
  // Financial crises / market shocks
  { date: '1971-08-15', label: 'Nixon Shock',           category: 'financial',    description: 'US ends gold convertibility of the dollar — Bretton Woods collapses', source: 'https://en.wikipedia.org/wiki/Nixon_shock' },
  { date: '1973-10-17', label: 'OPEC Oil Embargo',      category: 'financial',    description: 'Arab oil embargo quadruples crude prices; stagflation; Dow -45% over 2 years', source: 'https://en.wikipedia.org/wiki/1973_oil_crisis' },
  { date: '1979-10-06', label: 'Volcker Shock',         category: 'financial',    description: 'Fed switches to money-supply targeting; rates head toward 20% to break inflation', source: 'https://en.wikipedia.org/wiki/Volcker_shock' },
  { date: '1987-10-19', label: 'Black Monday',          category: 'financial',    description: 'Largest one-day % crash in history — Dow -22.6% in a single session' },
  { date: '1994-12-20', label: 'Mexico Peso Crisis',    category: 'financial',    description: 'Tequila crisis — peso devaluation triggers emerging-market contagion', source: 'https://en.wikipedia.org/wiki/Mexican_peso_crisis' },
  { date: '1998-08-17', label: 'Russia Default',        category: 'financial',    description: 'Russia defaults on domestic debt and devalues the ruble; triggers LTCM collapse', source: 'https://en.wikipedia.org/wiki/1998_Russian_financial_crisis' },
  { date: '1997-07-02', label: 'Asian Crisis',         category: 'financial',    description: 'Thai baht float triggers the Asian financial crisis; contagion across EM' },
  { date: '1998-09-23', label: 'LTCM Bailout',          category: 'financial',    description: 'Fed-orchestrated rescue of hedge fund Long-Term Capital Management' },
  { date: '2000-03-10', label: 'Dot-com Peak',          category: 'financial',    description: 'NASDAQ composite ATH — dot-com bubble peak before 78% crash' },
  { date: '2001-09-17', label: '9/11 Markets Reopen',   category: 'financial',    description: 'NYSE reopens after 9/11; Dow falls 14.3% in a week' },
  { date: '2007-08-09', label: 'GFC Begins',            category: 'financial',    description: 'BNP Paribas halts withdrawals — global financial crisis trigger' },
  { date: '2008-03-17', label: 'Bear Stearns',          category: 'financial',    description: 'Bear Stearns emergency sale to JPMorgan ($2/share)' },
  { date: '2008-09-15', label: 'Lehman Fails',          category: 'financial',    description: 'Lehman Brothers files Chapter 11 — largest bankruptcy in US history' },
  { date: '2008-09-29', label: 'TARP Rejected',         category: 'financial',    description: 'US House rejects $700B bailout; Dow falls 778 pts (largest single-day drop at the time)' },
  { date: '2010-04-27', label: 'Greece Junk',           category: 'financial',    description: 'S&P downgrades Greece to junk; EU sovereign debt crisis begins' },
  { date: '2010-05-06', label: 'Flash Crash',           category: 'financial',    description: 'US markets flash crash — Dow briefly falls 1,000 pts in minutes' },
  { date: '2011-08-05', label: 'US Downgrade',          category: 'financial',    description: 'S&P strips US AAA credit rating for the first time in history' },
  { date: '2015-08-24', label: 'China Black Monday',    category: 'financial',    description: 'Shanghai Composite -8.5%; Dow opens -1,000 pts amid China growth fears' },
  { date: '2018-02-05', label: 'VIX Volmageddon',       category: 'financial',    description: 'XIV/SVXY collapse — inverse-VIX ETPs wiped out; Dow -1,175 pts' },
  { date: '2020-03-09', label: 'COVID Crash',           category: 'financial',    description: 'COVID + oil war trigger; Dow -2,014 pts — circuit breakers trip' },
  { date: '2020-03-16', label: 'COVID Bottom Near',     category: 'financial',    description: 'Dow -2,997 pts (largest single-day point drop); S&P circuit breakers trigger' },
  { date: '2020-03-23', label: 'COVID Low',             category: 'financial',    description: 'S&P 500 intraday low — 34% drawdown from Feb ATH; Fed pledges unlimited QE' },
  { date: '2021-12-09', label: 'Evergrande Default',    category: 'financial',    description: 'Fitch declares China Evergrande in default — $300B property-debt crisis' },
  { date: '2022-09-23', label: 'UK Gilt Crisis',        category: 'financial',    description: 'Truss mini-budget triggers gilts crash; BoE emergency bond buying' },
  { date: '2023-03-10', label: 'SVB Collapse',          category: 'financial',    description: 'Silicon Valley Bank fails — largest US bank failure since 2008' },
  { date: '2023-03-19', label: 'Credit Suisse',         category: 'financial',    description: 'Credit Suisse emergency rescue by UBS orchestrated by Swiss regulator' },
  { date: '2023-05-01', label: 'First Republic',        category: 'financial',    description: 'First Republic Bank seized and sold to JPMorgan — 2nd-largest US bank failure' },
  { date: '2024-08-05', label: 'Yen Carry Unwind',      category: 'financial',    description: 'Yen carry trade unwind; Nikkei -12.4% — worst day since 1987' },

  // Pandemics
  { date: '1981-06-05', label: 'HIV/AIDS Recognized',   category: 'pandemic',     description: 'CDC reports the first AIDS cases — start of a pandemic that has killed 40M+', source: 'https://en.wikipedia.org/wiki/History_of_HIV/AIDS' },
  { date: '2003-04-02', label: 'SARS Peak',             category: 'pandemic',     description: 'SARS epidemic at peak; WHO issues global travel advisory' },
  { date: '2009-06-11', label: 'H1N1 Pandemic',         category: 'pandemic',     description: 'WHO declares H1N1 swine flu a pandemic — first since 1968' },
  { date: '2014-08-08', label: 'Ebola PHEIC',           category: 'pandemic',     description: 'WHO declares West African Ebola outbreak a global health emergency' },
  { date: '2020-01-30', label: 'COVID PHEIC',           category: 'pandemic',     description: 'WHO declares COVID-19 a Public Health Emergency of International Concern' },
  { date: '2020-03-11', label: 'COVID Pandemic',        category: 'pandemic',     description: 'WHO officially declares COVID-19 a global pandemic' },
  { date: '2022-07-23', label: 'Mpox PHEIC',            category: 'pandemic',     description: 'WHO declares the multi-country mpox (monkeypox) outbreak a global emergency' },

  // Wars / military conflicts
  { date: '1973-10-06', label: 'Yom Kippur War',        category: 'war',          description: 'Egypt and Syria attack Israel; war triggers the OPEC oil embargo', source: 'https://en.wikipedia.org/wiki/Yom_Kippur_War' },
  { date: '1975-04-30', label: 'Fall of Saigon',        category: 'war',          description: 'North Vietnam captures Saigon — end of the Vietnam War', source: 'https://en.wikipedia.org/wiki/Fall_of_Saigon' },
  { date: '1979-12-24', label: 'USSR Invades Afghanistan', category: 'war',       description: 'Soviet invasion begins a 10-year war; Cold War tensions spike', source: 'https://en.wikipedia.org/wiki/Soviet%E2%80%93Afghan_War' },
  { date: '1980-09-22', label: 'Iran-Iraq War',         category: 'war',          description: 'Iraq invades Iran — 8-year Gulf war; major oil disruption', source: 'https://en.wikipedia.org/wiki/Iran%E2%80%93Iraq_War' },
  { date: '1990-08-02', label: 'Iraq Invades Kuwait',   category: 'war',          description: 'Iraq invades Kuwait — oil shock; sets up the Gulf War', source: 'https://en.wikipedia.org/wiki/Invasion_of_Kuwait' },
  { date: '1991-01-17', label: 'Desert Storm',          category: 'war',          description: 'US-led coalition launches the Gulf War air campaign; markets rally', source: 'https://en.wikipedia.org/wiki/Gulf_War' },
  { date: '1999-03-24', label: 'NATO Strikes Kosovo',   category: 'war',          description: 'NATO begins a 78-day bombing campaign against Yugoslavia', source: 'https://en.wikipedia.org/wiki/NATO_bombing_of_Yugoslavia' },
  { date: '2001-10-07', label: 'Afghanistan War',       category: 'war',          description: 'US launches Operation Enduring Freedom — Afghanistan War begins' },
  { date: '2003-03-20', label: 'Iraq War',              category: 'war',          description: 'US-led coalition invades Iraq — Iraq War begins' },
  { date: '2011-03-15', label: 'Syria War',             category: 'war',          description: 'Syrian civil war begins amid Arab Spring uprising' },
  { date: '2014-03-18', label: 'Crimea Annexed',        category: 'war',          description: 'Russia formally annexes Crimea from Ukraine' },
  { date: '2021-08-15', label: 'Fall of Kabul',         category: 'war',          description: 'Taliban take Kabul as US completes withdrawal from Afghanistan' },
  { date: '2022-02-24', label: 'Ukraine Invasion',      category: 'war',          description: 'Russia launches full-scale invasion of Ukraine; global energy and food shock' },
  { date: '2023-10-07', label: 'Hamas Attack',          category: 'war',          description: 'Hamas attacks southern Israel; Israel-Gaza war begins' },
  { date: '2024-04-13', label: 'Iran Strikes Israel',   category: 'war',          description: "Iran's first-ever direct missile/drone attack on Israel" },
  { date: '2025-06-13', label: '12-Day War',            category: 'war',          description: 'Israel strikes Iran nuclear/military sites; US joins; ceasefire 24 Jun 2025', source: 'https://en.wikipedia.org/wiki/Twelve-Day_War' },
  { date: '2026-02-28', label: '2026 Iran War',         category: 'war',          description: 'US strikes Iran; Iran closes the Strait of Hormuz; WTI crude +66% ($67→$111)', source: 'https://en.wikipedia.org/wiki/2026_Iran_war' },

  // Terrorism
  { date: '1972-09-05', label: 'Munich Massacre',       category: 'terrorism',    description: '11 Israeli Olympic athletes taken hostage and killed in Munich', source: 'https://en.wikipedia.org/wiki/Munich_massacre' },
  { date: '1988-12-21', label: 'Lockerbie Bombing',     category: 'terrorism',    description: 'Pan Am Flight 103 destroyed over Scotland — 270 killed', source: 'https://en.wikipedia.org/wiki/Pan_Am_Flight_103' },
  { date: '1993-02-26', label: 'WTC Bombing (1st)',     category: 'terrorism',    description: 'Truck bomb at the World Trade Center — first al-Qaeda-linked US attack', source: 'https://en.wikipedia.org/wiki/1993_World_Trade_Center_bombing' },
  { date: '1995-03-20', label: 'Tokyo Sarin Attack',    category: 'terrorism',    description: 'Aum Shinrikyo releases sarin on the Tokyo subway — 13 killed', source: 'https://en.wikipedia.org/wiki/Tokyo_subway_sarin_attack' },
  { date: '1995-04-19', label: 'Oklahoma City Bombing', category: 'terrorism',    description: 'Truck bomb destroys a federal building — 168 killed; worst US domestic attack', source: 'https://en.wikipedia.org/wiki/Oklahoma_City_bombing' },
  { date: '1998-08-07', label: 'US Embassy Bombings',   category: 'terrorism',    description: 'Al-Qaeda bombs US embassies in Kenya and Tanzania — 224 killed', source: 'https://en.wikipedia.org/wiki/1998_United_States_embassy_bombings' },
  { date: '2001-09-11', label: '9/11',                  category: 'terrorism',    description: '9/11 attacks — NYSE and NASDAQ closed for 4 trading days' },
  { date: '2004-03-11', label: 'Madrid Bombings',       category: 'terrorism',    description: 'Madrid train bombings — 191 killed, 2,000 injured' },
  { date: '2005-07-07', label: 'London 7/7',            category: 'terrorism',    description: 'London transport bombings — 52 killed; FTSE 100 initially drops ~200 pts' },
  { date: '2008-11-26', label: 'Mumbai Attacks',        category: 'terrorism',    description: 'Coordinated attacks across Mumbai — 175 killed over 4 days' },
  { date: '2013-04-15', label: 'Boston Marathon',       category: 'terrorism',    description: 'Boston Marathon bombing — 3 killed, hundreds injured' },
  { date: '2015-11-13', label: 'Paris Attacks',         category: 'terrorism',    description: 'Paris attacks — 130 killed; European markets fall ~3% Monday open' },
  { date: '2016-07-14', label: 'Nice Attack',           category: 'terrorism',    description: 'Truck attack on Bastille Day crowd in Nice — 86 killed' },

  // Geopolitical
  { date: '1972-02-21', label: 'Nixon Visits China',    category: 'geopolitical', description: 'Nixon visits China — landmark opening of US-China relations', source: 'https://en.wikipedia.org/wiki/1972_Nixon_visit_to_China' },
  { date: '1974-08-09', label: 'Nixon Resigns',         category: 'geopolitical', description: 'First US presidential resignation, over the Watergate scandal', source: 'https://en.wikipedia.org/wiki/Watergate_scandal' },
  { date: '1979-11-04', label: 'Iran Hostage Crisis',   category: 'geopolitical', description: 'US embassy in Tehran seized — 444-day hostage crisis; oil/dollar shock', source: 'https://en.wikipedia.org/wiki/Iran_hostage_crisis' },
  { date: '1989-06-04', label: 'Tiananmen Square',      category: 'geopolitical', description: "Beijing crushes pro-democracy protests; reshapes the West's China relations", source: 'https://en.wikipedia.org/wiki/1989_Tiananmen_Square_protests_and_massacre' },
  { date: '1989-11-09', label: 'Berlin Wall Falls',     category: 'geopolitical', description: 'Fall of the Berlin Wall — the symbolic end of the Cold War', source: 'https://en.wikipedia.org/wiki/Fall_of_the_Berlin_Wall' },
  { date: '1991-12-26', label: 'USSR Dissolves',        category: 'geopolitical', description: 'Soviet Union formally dissolved — largest geopolitical shift since WWII', source: 'https://en.wikipedia.org/wiki/Dissolution_of_the_Soviet_Union' },
  { date: '1992-02-07', label: 'Maastricht Treaty',     category: 'geopolitical', description: 'Treaty signed creating the European Union and the path to the euro', source: 'https://en.wikipedia.org/wiki/Maastricht_Treaty' },
  { date: '1994-04-27', label: 'End of Apartheid',      category: 'geopolitical', description: "South Africa's first multiracial election; Mandela elected president", source: 'https://en.wikipedia.org/wiki/1994_South_African_general_election' },
  { date: '1997-07-01', label: 'Hong Kong Handover',    category: 'geopolitical', description: 'UK transfers sovereignty of Hong Kong to China', source: 'https://en.wikipedia.org/wiki/Transfer_of_sovereignty_over_Hong_Kong' },
  { date: '1999-01-01', label: 'Euro Launched',         category: 'geopolitical', description: 'The euro is introduced as an accounting currency in 11 countries', source: 'https://en.wikipedia.org/wiki/History_of_the_euro' },
  { date: '2001-09-20', label: 'War on Terror',         category: 'geopolitical', description: 'Bush declares the "War on Terror" before Congress — reshapes global geopolitics for decades', source: 'https://en.wikipedia.org/wiki/War_on_terror' },
  { date: '2010-12-17', label: 'Arab Spring Begins',    category: 'geopolitical', description: 'Bouazizi self-immolates in Tunisia, sparking the Arab Spring — topples 4 governments, reshapes the Middle East', source: 'https://en.wikipedia.org/wiki/Arab_Spring' },
  { date: '2015-07-14', label: 'Iran Nuclear Deal',     category: 'geopolitical', description: 'JCPOA signed — landmark multilateral treaty reducing nuclear risk and lifting Iran sanctions', source: 'https://en.wikipedia.org/wiki/Joint_Comprehensive_Plan_of_Action' },
  { date: '2016-06-24', label: 'Brexit Vote',           category: 'geopolitical', description: 'UK votes to leave EU; sterling falls 8%, FTSE 250 -7%' },
  { date: '2018-03-22', label: 'US-China Tariffs',      category: 'geopolitical', description: 'Trump signs tariff order on $60B China goods — US-China trade war begins' },
  { date: '2019-08-05', label: 'China Yuan Weakens',    category: 'geopolitical', description: 'China lets yuan fall past 7/USD; US labels China a currency manipulator; Dow -767' },
  { date: '2020-01-31', label: 'Brexit Day',            category: 'geopolitical', description: 'UK formally leaves the European Union after 47 years of membership' },
  { date: '2021-01-06', label: 'Capitol Storming',      category: 'geopolitical', description: 'US Capitol stormed during certification of 2020 election results' },
  { date: '2025-04-02', label: 'Liberation Day',        category: 'geopolitical', description: 'Trump announces sweeping "Liberation Day" tariffs; S&P falls ~10% in 2 days' },

  // US presidential elections — Election Day (first Tuesday after the first Monday in November)
  { date: '1972-11-07', label: 'Nixon Re-elected',      category: 'elections',    description: 'Richard Nixon (R) defeats George McGovern in a landslide', source: 'https://en.wikipedia.org/wiki/1972_United_States_presidential_election' },
  { date: '1976-11-02', label: 'Carter Elected',        category: 'elections',    description: 'Jimmy Carter (D) defeats incumbent Gerald Ford', source: 'https://en.wikipedia.org/wiki/1976_United_States_presidential_election' },
  { date: '1980-11-04', label: 'Reagan Elected',        category: 'elections',    description: 'Ronald Reagan (R) defeats incumbent Jimmy Carter', source: 'https://en.wikipedia.org/wiki/1980_United_States_presidential_election' },
  { date: '1984-11-06', label: 'Reagan Re-elected',     category: 'elections',    description: 'Ronald Reagan (R) defeats Walter Mondale in a 49-state landslide', source: 'https://en.wikipedia.org/wiki/1984_United_States_presidential_election' },
  { date: '1988-11-08', label: 'Bush Sr Elected',       category: 'elections',    description: 'George H. W. Bush (R) defeats Michael Dukakis', source: 'https://en.wikipedia.org/wiki/1988_United_States_presidential_election' },
  { date: '1992-11-03', label: 'Clinton Elected',       category: 'elections',    description: 'Bill Clinton (D) defeats incumbent George H. W. Bush', source: 'https://en.wikipedia.org/wiki/1992_United_States_presidential_election' },
  { date: '1996-11-05', label: 'Clinton Re-elected',    category: 'elections',    description: 'Bill Clinton (D) defeats Bob Dole', source: 'https://en.wikipedia.org/wiki/1996_United_States_presidential_election' },
  { date: '2000-11-07', label: 'Bush Jr Elected',       category: 'elections',    description: 'George W. Bush (R) defeats Al Gore after a contested Florida recount', source: 'https://en.wikipedia.org/wiki/2000_United_States_presidential_election' },
  { date: '2004-11-02', label: 'Bush Jr Re-elected',    category: 'elections',    description: 'George W. Bush (R) defeats John Kerry', source: 'https://en.wikipedia.org/wiki/2004_United_States_presidential_election' },
  { date: '2008-11-04', label: 'Obama Elected',         category: 'elections',    description: 'Barack Obama (D) defeats John McCain — first Black US president', source: 'https://en.wikipedia.org/wiki/2008_United_States_presidential_election' },
  { date: '2012-11-06', label: 'Obama Re-elected',      category: 'elections',    description: 'Barack Obama (D) defeats Mitt Romney', source: 'https://en.wikipedia.org/wiki/2012_United_States_presidential_election' },
  { date: '2016-11-08', label: 'Trump Elected (2016)',  category: 'elections',    description: 'Donald Trump (R) defeats Hillary Clinton', source: 'https://en.wikipedia.org/wiki/2016_United_States_presidential_election' },
  { date: '2020-11-03', label: 'Biden Elected',         category: 'elections',    description: 'Joe Biden (D) defeats incumbent Donald Trump', source: 'https://en.wikipedia.org/wiki/2020_United_States_presidential_election' },
  { date: '2024-11-05', label: 'Trump Elected (2024)',  category: 'elections',    description: 'Donald Trump (R) defeats Kamala Harris', source: 'https://en.wikipedia.org/wiki/2024_United_States_presidential_election' },

  // US midterm elections — held every 2 years between presidential elections
  { date: '1970-11-03', label: 'Midterms 1970',         category: 'elections',    description: 'Dems gain 12 Senate seats; Nixon pushes "silent majority" theme amid Vietnam', source: 'https://en.wikipedia.org/wiki/1970_United_States_elections' },
  { date: '1974-11-05', label: 'Midterms 1974',         category: 'elections',    description: 'Post-Watergate wave: Dems gain 49 House and 4 Senate seats', source: 'https://en.wikipedia.org/wiki/1974_United_States_elections' },
  { date: '1978-11-07', label: 'Midterms 1978',         category: 'elections',    description: 'Reps gain 15 House seats; Carter presidency weakening amid inflation', source: 'https://en.wikipedia.org/wiki/1978_United_States_elections' },
  { date: '1982-11-02', label: 'Midterms 1982',         category: 'elections',    description: 'Recession backlash: Dems gain 26 House seats against Reagan', source: 'https://en.wikipedia.org/wiki/1982_United_States_elections' },
  { date: '1986-11-04', label: 'Midterms 1986',         category: 'elections',    description: 'Dems retake Senate (+8 seats); Iran-Contra scandal emerges', source: 'https://en.wikipedia.org/wiki/1986_United_States_elections' },
  { date: '1990-11-06', label: 'Midterms 1990',         category: 'elections',    description: 'Dems gain 7 House and 1 Senate seat; Gulf War buildup begins', source: 'https://en.wikipedia.org/wiki/1990_United_States_elections' },
  { date: '1994-11-08', label: 'Midterms 1994',         category: 'elections',    description: '"Republican Revolution": Reps gain 54 House and 8 Senate seats — Gingrich becomes Speaker', source: 'https://en.wikipedia.org/wiki/1994_United_States_elections' },
  { date: '1998-11-03', label: 'Midterms 1998',         category: 'elections',    description: 'Dems gain 5 House seats (rare gain for president\'s party) amid Clinton impeachment', source: 'https://en.wikipedia.org/wiki/1998_United_States_elections' },
  { date: '2002-11-05', label: 'Midterms 2002',         category: 'elections',    description: 'Post-9/11: Reps gain 8 House and 2 Senate seats — rare gain for president\'s party', source: 'https://en.wikipedia.org/wiki/2002_United_States_elections' },
  { date: '2006-11-07', label: 'Midterms 2006',         category: 'elections',    description: 'Iraq War backlash: Dems gain 31 House and 6 Senate seats; Pelosi first female Speaker', source: 'https://en.wikipedia.org/wiki/2006_United_States_elections' },
  { date: '2010-11-02', label: 'Midterms 2010',         category: 'elections',    description: 'Tea Party wave: Reps gain 63 House seats — largest House shift since 1938', source: 'https://en.wikipedia.org/wiki/2010_United_States_elections' },
  { date: '2014-11-04', label: 'Midterms 2014',         category: 'elections',    description: 'Reps gain Senate majority (+9 seats) and 13 House seats', source: 'https://en.wikipedia.org/wiki/2014_United_States_elections' },
  { date: '2018-11-06', label: 'Midterms 2018',         category: 'elections',    description: 'Dems retake House (+41 seats); Reps gain 2 Senate seats', source: 'https://en.wikipedia.org/wiki/2018_United_States_elections' },
  { date: '2022-11-08', label: 'Midterms 2022',         category: 'elections',    description: 'Expected "red wave" falls short; Reps win slim House majority (+9), Dems keep Senate', source: 'https://en.wikipedia.org/wiki/2022_United_States_elections' },
  { date: '2026-11-03', label: 'Midterms 2026',         category: 'elections',    description: 'US midterm elections — House (all 435 seats) and Senate (33 seats)', source: 'https://en.wikipedia.org/wiki/2026_United_States_elections' },

  // Crypto-specific
  { date: '2013-12-05', label: 'China Bans BTC',        category: 'crypto',       description: 'China bans financial institutions from handling Bitcoin; BTC falls 50%' },
  { date: '2014-02-24', label: 'Mt. Gox Collapse',      category: 'crypto',       description: 'Mt. Gox halts trading and collapses — ~850,000 BTC lost' },
  { date: '2017-12-17', label: 'BTC Hits $20k',         category: 'crypto',       description: 'Bitcoin reaches ~$20,000 for the first time at the 2017 bull-run peak' },
  { date: '2020-03-12', label: 'Crypto Black Thursday', category: 'crypto',       description: 'COVID crash — BTC -50% in a day to ~$3,800' },
  { date: '2021-05-19', label: 'BTC Crash -50%',        category: 'crypto',       description: 'Bitcoin crashes 50% from ATH; China bans crypto mining' },
  { date: '2021-09-07', label: 'El Salvador BTC',       category: 'crypto',       description: 'El Salvador adopts Bitcoin as legal tender — a world first' },
  { date: '2021-11-10', label: 'BTC ATH $69k',          category: 'crypto',       description: 'Bitcoin reaches its 2021 cycle all-time high of ~$69,000' },
  { date: '2022-05-09', label: 'LUNA Collapse',         category: 'crypto',       description: 'TerraUSD/LUNA collapse — $40B market cap wiped in days' },
  { date: '2022-09-15', label: 'Ethereum Merge',        category: 'crypto',       description: 'Ethereum transitions to proof-of-stake — energy use drops ~99.9%' },
  { date: '2022-11-11', label: 'FTX Bankrupt',          category: 'crypto',       description: 'FTX files Chapter 11; Sam Bankman-Fried arrested; BTC -25% in a week' },
  { date: '2024-01-10', label: 'Spot BTC ETF',          category: 'crypto',       description: 'SEC approves the first US spot Bitcoin ETFs — trading begins next day' },
  { date: '2024-12-05', label: 'BTC Hits $100k',        category: 'crypto',       description: 'Bitcoin crosses $100,000 for the first time' },
  { date: '2025-10-06', label: 'BTC ATH $126k',         category: 'crypto',       description: 'Bitcoin sets a record ~$126,000 — 2025 cycle all-time high', source: 'https://en.wikipedia.org/wiki/History_of_bitcoin' },

  // IPOs / market debuts — listing day on the primary exchange
  { date: '1980-12-12', label: 'Apple IPO',             category: 'ipo',          description: 'Apple lists on NASDAQ at $22/share — largest IPO since Ford (1956)' },
  { date: '1986-03-13', label: 'Microsoft IPO',         category: 'ipo',          description: 'Microsoft IPOs at $21/share, valuing the company at ~$777M' },
  { date: '1997-05-15', label: 'Amazon IPO',            category: 'ipo',          description: 'Amazon lists on NASDAQ at $18/share (~$438M valuation)' },
  { date: '1999-01-22', label: 'Nvidia IPO',            category: 'ipo',          description: 'Nvidia IPOs on NASDAQ at $12/share' },
  { date: '2004-08-19', label: 'Google IPO',            category: 'ipo',          description: 'Google Dutch-auction IPO at $85/share — ~$23B valuation' },
  { date: '2008-03-19', label: 'Visa IPO',              category: 'ipo',          description: 'Visa raises $17.9B — then the largest IPO in US history' },
  { date: '2010-06-29', label: 'Tesla IPO',             category: 'ipo',          description: 'Tesla lists on NASDAQ at $17/share — first US automaker IPO since Ford' },
  { date: '2012-05-18', label: 'Facebook IPO',          category: 'ipo',          description: 'Facebook IPOs at $38/share (~$104B) — botched NASDAQ debut' },
  { date: '2014-09-19', label: 'Alibaba IPO',           category: 'ipo',          description: 'Alibaba raises $25B on NYSE — largest IPO in history at the time' },
  { date: '2019-05-10', label: 'Uber IPO',              category: 'ipo',          description: 'Uber lists on NYSE at $45/share (~$82B); falls on debut' },
  { date: '2019-12-11', label: 'Saudi Aramco IPO',      category: 'ipo',          description: 'Aramco lists on Tadawul — $25.6B raise, ~$1.7T valuation (largest ever)' },
  { date: '2020-09-16', label: 'Snowflake IPO',         category: 'ipo',          description: 'Snowflake IPOs at $120/share — largest software IPO ever (~$33B)' },
  { date: '2020-12-10', label: 'Airbnb IPO',            category: 'ipo',          description: 'Airbnb lists on NASDAQ; shares more than double on debut (~$100B)' },
  { date: '2021-04-14', label: 'Coinbase Listing',      category: 'ipo',          description: 'Coinbase direct-lists on NASDAQ at a ~$86B opening valuation' },
  { date: '2021-07-29', label: 'Robinhood IPO',         category: 'ipo',          description: 'Robinhood IPOs on NASDAQ at $38/share (~$32B)' },
  { date: '2021-11-10', label: 'Rivian IPO',            category: 'ipo',          description: 'Rivian raises ~$12B — largest US IPO since 2014 (~$66B valuation)' },
  { date: '2023-09-14', label: 'ARM IPO',               category: 'ipo',          description: 'Arm Holdings re-lists on NASDAQ (~$54B) — largest IPO of 2023' },
  { date: '2024-03-21', label: 'Reddit IPO',            category: 'ipo',          description: 'Reddit lists on NYSE at $34/share; jumps ~48% on debut' },
  { date: '2026-06-12', label: 'SpaceX IPO',            category: 'ipo',          description: 'SpaceX lists on NASDAQ (SPCX) at $135/share, ~$1.77T — largest IPO in history', source: 'https://www.cnbc.com/2026/05/20/spacex-ipo-live-updates.html' },
];

export const MACRO_INDICATORS: MacroIndicator[] = [
  // Rates
  { id: 'DFEDTARU', name: 'USA Interest Rate',     category: 'Rates',       unit: '%',
    source: { type: 'fomc',    label: 'Federal Reserve',
              url: 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm' } },
  { id: 'FEDFUNDS', name: 'Effective Fed Funds Rate', category: 'Rates',     unit: '%',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/FEDFUNDS' } },
  { id: 'ECBDFR',   name: 'EU Interest Rate',      category: 'Rates',       unit: '%',
    source: { type: 'ecb',     label: 'ECB Data Portal',
              url: 'https://data.ecb.europa.eu/data/datasets/FM/FM.B.U2.EUR.4F.KR.DFR.LEV' } },
  // Japan policy rate proxy — OECD "immediate" (overnight) call-money/interbank
  // rate for Japan, monthly. Tracks the BoJ uncollateralized overnight call rate
  // target. FRED (key) + DBnomics mirror; both reach this OECD-sourced series.
  { id: 'IRSTCI01JPM156N', name: 'Japan Interest Rate', category: 'Rates',   unit: '%',
    source: { type: 'fred',    label: 'FRED / OECD',
              url: 'https://www.stat-search.boj.or.jp/ssi/mtshtml/ir01_d_1_en.html' } },
  { id: 'DGS10',    name: 'US 10Y Yield',          category: 'Rates',       unit: '%',
    source: { type: 'treasury',label: 'US Treasury',
              url: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates' } },
  { id: 'DGS2',     name: 'US 2Y Yield',           category: 'Rates',       unit: '%',
    source: { type: 'treasury',label: 'US Treasury',
              url: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates' } },
  // 10Y-2Y spread — goes negative during yield-curve inversions (recession leading indicator)
  { id: 'T10Y2Y',   name: '10Y–2Y Spread',          category: 'Rates',       unit: '%',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/T10Y2Y' } },
  // Longer-run median dot from the FOMC Summary of Economic Projections (dot plot):
  // the Fed's estimate of the neutral fed funds rate. One value per SEP meeting
  // since 2012 — tracks how the Committee's long-run rate view shifts over time.
  { id: 'FEDTARMDLR', name: 'Fed Long-Run Rate (Dot Plot)', category: 'Rates', unit: '%',
    source: { type: 'fred',    label: 'FRED / FOMC SEP',
              url: 'https://fred.stlouisfed.org/series/FEDTARMDLR' } },
  // FOMC meeting dates — rendered as vertical reference lines (event overlay, not a data series).
  // Meetings that publish a Summary of Economic Projections (the "dot plot") are highlighted.
  { id: 'FOMC_MEETINGS', name: 'FOMC Meeting Dates', category: 'Events',     unit: 'idx',
    source: { type: 'computed', label: 'Federal Reserve (dot-plot meetings highlighted)',
              url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm' } },
  // Fed chair timeline — nomination date + first FOMC meeting as chair, per chair.
  { id: 'FED_CHAIRS', name: 'Fed Chairs', category: 'Events',     unit: 'idx',
    source: { type: 'computed', label: 'Federal Reserve — chair nomination + first meeting',
              url: 'https://en.wikipedia.org/wiki/Chair_of_the_Federal_Reserve' } },
  // Monthly grid markers — auto-generated, one point per month since 1970.
  { id: 'MONTHLY_MARKERS', name: 'Monthly Grid', category: 'Events', unit: 'idx',
    source: { type: 'computed', label: 'Generated — 1st of every month since Jan 1970',
              url: '' } },
  // Yearly grid markers — auto-generated, one point per year since 1970.
  { id: 'YEARLY_MARKERS', name: 'Yearly Grid', category: 'Events', unit: 'idx',
    source: { type: 'computed', label: 'Generated — 1st of every year since 1970',
              url: '' } },
  // Inflation
  { id: 'CPIAUCSL', name: 'CPI (All Items)',        category: 'Inflation',   unit: 'idx',
    source: { type: 'bls',     label: 'BLS',
              url: 'https://www.bls.gov/cpi/' } },
  { id: 'CPILFESL', name: 'Core CPI',               category: 'Inflation',   unit: 'idx',
    source: { type: 'bls',     label: 'BLS',
              url: 'https://www.bls.gov/cpi/' } },
  // Growth
  { id: 'GDP',      name: 'Nominal GDP',            category: 'Growth',      unit: 'B$',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/GDP' } },
  { id: 'GDPC1',    name: 'Real GDP',               category: 'Growth',      unit: 'B$',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/GDPC1' } },
  { id: 'INDPRO',   name: 'Industrial Production',  category: 'Growth',      unit: 'idx',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/INDPRO' } },
  // CMRMTSPL is reported in millions of chained 2017 $ on FRED; the computed handler divides by 1000 → billions.
  { id: 'CMRMTSPL', name: 'Real Mfg & Trade Sales', category: 'Growth',      unit: 'B$',
    source: { type: 'computed', label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/CMRMTSPL' } },
  { id: 'WEI',      name: 'Weekly Economic Index',  category: 'Growth',      unit: '%',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/WEI' } },
  // MFPPBS: Private Business Sector — Total Factor Productivity (index, annual, BLS).
  { id: 'MFPPBS',   name: 'Total Factor Productivity', category: 'Growth',   unit: 'idx',
    source: { type: 'fred',    label: 'FRED / BLS',
              url: 'https://fred.stlouisfed.org/series/MFPPBS' } },
  // Employment
  { id: 'UNRATE',   name: 'US Unemployment',        category: 'Employment',  unit: '%',
    source: { type: 'bls',     label: 'BLS',
              url: 'https://www.bls.gov/cps/' } },
  { id: 'PAYEMS',   name: 'Nonfarm Payrolls',       category: 'Employment',  unit: 'K',
    source: { type: 'bls',     label: 'BLS CES',
              url: 'https://www.bls.gov/ces/' } },
  { id: 'JTSJOL',   name: 'Job Openings (JOLTS)',   category: 'Employment',  unit: 'K',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/JTSJOL' } },
  { id: 'CIVPART',  name: 'Labor Force Participation', category: 'Employment', unit: '%',
    source: { type: 'fred',    label: 'FRED / BLS',
              url: 'https://fred.stlouisfed.org/series/CIVPART' } },
  { id: 'LES1252881600Q', name: 'Median Real Weekly Earnings', category: 'Employment', unit: '$',
    source: { type: 'fred',    label: 'FRED / BLS',
              url: 'https://fred.stlouisfed.org/series/LES1252881600Q' } },
  // Real Estate
  { id: 'HOUST',    name: 'Housing Starts',         category: 'Real Estate', unit: 'K',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/HOUST' } },
  { id: 'MORTGAGE30US', name: '30Y Mortgage Rate',  category: 'Real Estate', unit: '%',
    source: { type: 'fred',    label: 'FRED / Freddie Mac',
              url: 'https://fred.stlouisfed.org/series/MORTGAGE30US' } },
  // Money
  { id: 'M2SL',     name: 'M2 Money Stock',         category: 'Money',       unit: 'B$',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/M2SL' } },
  // TOTBKCR: Bank Credit, All Commercial Banks — already in billions on FRED (no scaling).
  { id: 'TOTBKCR',  name: 'Bank Credit (All Comm.)', category: 'Money',      unit: 'B$',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/TOTBKCR' } },
  // TOTALSLAR: Percent Change of Total Consumer Credit (annual rate, monthly, Fed G.19).
  { id: 'TOTALSLAR', name: 'Consumer Credit (% chg)', category: 'Money',     unit: '%',
    source: { type: 'fred',    label: 'FRED / Federal Reserve',
              url: 'https://fred.stlouisfed.org/series/TOTALSLAR' } },
  // WALCL is reported in millions on FRED; the computed handler divides by 1000 → billions.
  { id: 'WALCL',    name: 'Fed Balance Sheet (WALCL)', category: 'Money',      unit: 'B$',
    source: { type: 'computed', label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/WALCL' } },
  // Bank credit quality — quarterly FRED series
  { id: 'DRCLACBS', name: 'Consumer Loan Delinquency', category: 'Money',    unit: '%',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/DRCLACBS' } },
  { id: 'DRALACBN', name: 'All Loans Delinquency',  category: 'Money',       unit: '%',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/DRALACBN' } },
  { id: 'DRCRELEXFACBS', name: 'CRE Loan Delinquency', category: 'Money',    unit: '%',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/DRCRELEXFACBS' } },
  // Discontinued quarterly Z.1 Financial Accounts series — latest point may be old.
  // Full FRED title: "Issuers of Asset-Backed Securities; Commercial Mortgages,
  // Including REIT Securitized Commercial Mortgages; Asset, Transactions".
  { id: 'BOGZ1FA673065500Q', name: 'ABS Issuers: Commercial Mortgages', category: 'Money', unit: 'idx',
    source: { type: 'fred',    label: 'FRED (discontinued)',
              url: 'https://fred.stlouisfed.org/series/BOGZ1FA673065500Q' } },
  // Commodities — computed from Yahoo Finance prices; no FRED key needed
  { id: 'GOLD_SILVER', name: 'Gold/Silver Ratio',   category: 'Commodities', unit: 'idx',
    source: { type: 'yahoo_ratio', label: 'Yahoo Finance',
              url: 'https://finance.yahoo.com/commodities',
              numerator: 'GC=F', denominator: 'SI=F' } },
  // Sentiment — CBOE Volatility Index via Yahoo Finance
  { id: 'VIX',      name: 'VIX Volatility Index',    category: 'Sentiment',   unit: 'idx',
    source: { type: 'yahoo_price', label: 'Yahoo Finance',
              url: 'https://finance.yahoo.com/quote/%5EVIX',
              symbol: '^VIX' } },
  // Currency — ICE US Dollar Index via Yahoo Finance
  { id: 'DXY',      name: 'US Dollar Index (DXY)',   category: 'Currency',    unit: 'idx',
    source: { type: 'yahoo_price', label: 'Yahoo Finance',
              url: 'https://finance.yahoo.com/quote/DX-Y.NYB',
              symbol: 'DX-Y.NYB' } },
  // Crypto — computed server-side; bitbo.io charts are the visual reference
  { id: 'BTC_HALVING', name: 'Bitcoin Halvings',      category: 'Events',      unit: 'idx',
    source: { type: 'computed', label: 'Bitcoin halving schedule',
              url: 'https://charts.bitbo.io/halving-progress/' } },
  { id: 'BTC_RSI',  name: 'Bitcoin Monthly RSI',     category: 'Crypto',      unit: 'idx',
    source: { type: 'computed', label: 'Computed from BTC-USD (Yahoo)',
              url: 'https://charts.bitbo.io/monthly-rsi/' } },
  { id: 'BTC_MINER_REVENUE', name: 'Miner Monthly Revenue', category: 'Crypto', unit: 'B$',
    source: { type: 'computed', label: 'Computed from halving schedule + BTC-USD (Yahoo)',
              url: 'https://charts.bitbo.io/miner-monthly-revenue/' } },
  { id: 'BTC_MINED_MONTHLY', name: 'Monthly BTC Mined',     category: 'Crypto', unit: 'idx',
    source: { type: 'computed', label: 'Computed from halving schedule',
              url: 'https://charts.bitbo.io/miner-monthly-revenue/' } },
  { id: 'BTC_PRODUCTION_COST', name: 'BTC Production Cost',  category: 'Crypto', unit: '$',
    source: { type: 'computed', label: 'Computed: network hashrate × 25 J/TH × $0.05/kWh (blockchain.info)',
              url: 'https://en.macromicro.me/series/8194/bitcoin-production-total-cost' } },
  { id: 'BTC_DOMINANCE', name: 'BTC Market Dominance',     category: 'Crypto', unit: '%',
    source: { type: 'computed', label: 'CoinGecko',
              url: 'https://charts.bitbo.io/bitcoin-dominance/' } },
  { id: 'BTC_HASHRATE', name: 'Bitcoin Network Hashrate', category: 'Crypto', unit: 'EH/s',
    source: { type: 'computed', label: 'Network hashrate in EH/s (blockchain.info)',
              url: 'https://www.blockchain.com/explorer/charts/hash-rate' } },
  // Debt — US federal debt and sustainability metrics
  { id: 'GFDEGDQ188S', name: 'Debt / GDP Ratio',     category: 'Debt',        unit: '%',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/GFDEGDQ188S' } },
  { id: 'GFDEBTN',     name: 'US Federal Debt',       category: 'Debt',        unit: 'B$',
    source: { type: 'computed', label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/GFDEBTN' } },
  // Growth addition
  { id: 'A939RC0A052NBEA', name: 'Household Net Worth', category: 'Growth',    unit: 'B$',
    source: { type: 'fred',    label: 'FRED',
              url: 'https://fred.stlouisfed.org/series/A939RC0A052NBEA' } },
  // Market Value — S&P 500 valuation ratios from multpl.com (fetched through a
  // reader proxy because multpl blocks datacenter IPs directly).
  { id: 'SP500_PE',         name: 'S&P 500 P/E Ratio',        category: 'Market Value', unit: 'idx',
    source: { type: 'multpl', label: 'multpl.com',
              url: 'https://www.multpl.com/s-p-500-pe-ratio',
              slug: 's-p-500-pe-ratio' } },
  { id: 'SHILLER_CAPE',     name: 'S&P 500 Shiller CAPE',      category: 'Market Value', unit: 'idx',
    source: { type: 'multpl', label: 'multpl.com',
              url: 'https://www.multpl.com/shiller-pe',
              slug: 'shiller-pe' } },
  { id: 'SP500_EPS',        name: 'S&P 500 EPS (TTM)',         category: 'Market Value', unit: 'idx',
    source: { type: 'multpl', label: 'multpl.com',
              url: 'https://www.multpl.com/s-p-500-earnings',
              slug: 's-p-500-earnings' } },
  { id: 'SP500_EYIELD',     name: 'S&P 500 Earnings Yield',    category: 'Market Value', unit: '%',
    source: { type: 'multpl', label: 'multpl.com',
              url: 'https://www.multpl.com/s-p-500-earnings-yield',
              slug: 's-p-500-earnings-yield' } },
  { id: 'SP500_PSALES',     name: 'S&P 500 Price/Sales',       category: 'Market Value', unit: 'idx',
    source: { type: 'multpl', label: 'multpl.com',
              url: 'https://www.multpl.com/s-p-500-price-to-sales',
              slug: 's-p-500-price-to-sales' } },
  { id: 'SP500_PBOOK',      name: 'S&P 500 Price/Book',        category: 'Market Value', unit: 'idx',
    source: { type: 'multpl', label: 'multpl.com',
              url: 'https://www.multpl.com/s-p-500-price-to-book',
              slug: 's-p-500-price-to-book' } },
  // Events — per-category event calendars rendered as vertical overlay lines.
  // Each category is an independent indicator card with its own chart and Compare overlay.
  { id: 'EVENTS_FINANCIAL',    name: 'Financial Crises',    category: 'Events', unit: 'idx',
    source: { type: 'computed', label: 'Curated historical record',
              url: 'https://en.wikipedia.org/wiki/List_of_stock_market_crashes_and_bear_markets' } },
  { id: 'EVENTS_WAR',          name: 'Wars & Conflicts',    category: 'Events', unit: 'idx',
    source: { type: 'computed', label: 'Curated historical record',
              url: 'https://en.wikipedia.org/wiki/List_of_wars_and_anthropogenic_disasters_by_death_toll' } },
  { id: 'EVENTS_TERRORISM',    name: 'Terrorism',           category: 'Events', unit: 'idx',
    source: { type: 'computed', label: 'Curated historical record',
              url: 'https://en.wikipedia.org/wiki/List_of_terrorist_incidents' } },
  { id: 'EVENTS_PANDEMIC',     name: 'Pandemics',           category: 'Events', unit: 'idx',
    source: { type: 'computed', label: 'Curated historical record',
              url: 'https://en.wikipedia.org/wiki/List_of_epidemics_and_pandemics' } },
  { id: 'EVENTS_GEOPOLITICAL', name: 'Geopolitical Events', category: 'Events', unit: 'idx',
    source: { type: 'computed', label: 'Curated historical record',
              url: 'https://en.wikipedia.org/wiki/Geopolitics' } },
  { id: 'EVENTS_ELECTIONS',    name: 'US Elections',        category: 'Events', unit: 'idx',
    source: { type: 'computed', label: 'Curated historical record',
              url: 'https://en.wikipedia.org/wiki/List_of_United_States_presidential_elections' } },
  { id: 'EVENTS_CRYPTO',       name: 'Crypto Events',       category: 'Events', unit: 'idx',
    source: { type: 'computed', label: 'Curated historical record',
              url: 'https://en.wikipedia.org/wiki/History_of_bitcoin' } },
  { id: 'EVENTS_IPO',          name: 'Major IPOs',          category: 'Events', unit: 'idx',
    source: { type: 'computed', label: 'Curated historical record',
              url: 'https://en.wikipedia.org/wiki/List_of_largest_IPOs' } },
  { id: 'EVENTS_PERSONAL',     name: 'Personal Events',     category: 'Events', unit: 'idx',
    source: { type: 'computed', label: 'User-defined (add from Sources tab)',
              url: 'https://en.wikipedia.org/wiki/Personal_timeline' } },
  // Recessions — official NBER / OECD recession indicators. Binary 0/1 monthly
  // series: 1 = economy in recession. Rendered as shaded bands, not lines, so
  // they can be overlaid on any chart in Compare.
  // Only USREC (NBER-based) is kept — it is the one recession series FRED still
  // actively maintains. The OECD-based country indicators were discontinued
  // around 2022 and would never reflect a new recession, so they are excluded.
  { id: 'USREC',        name: 'US Recessions',        category: 'Recessions', unit: 'idx',
    source: { type: 'fred',    label: 'FRED / NBER',
              url: 'https://fred.stlouisfed.org/series/USREC' } },
  // Sahm Rule: 3-month moving avg of unemployment minus its 12-month trough.
  // Readings ≥ 0.5% have historically coincided with the start of a recession.
  { id: 'SAHMREALTIME', name: 'Sahm Rule Indicator',  category: 'Recessions', unit: '%',
    source: { type: 'fred',    label: 'FRED / Claudia Sahm',
              url: 'https://fred.stlouisfed.org/series/SAHMREALTIME' } },
];

// Recession indicator series — handled specially everywhere (shaded bands
// instead of lines). RECESSION_META carries the band label + tint for each.
export const RECESSION_SERIES = ['USREC'];

export const RECESSION_META: Record<string, { label: string; color: string }> = {
  USREC: { label: 'US Recession', color: '#64748b' },
};

// FOMC meeting dates (statement release day) — used for vertical reference lines in Compare.
// Includes emergency inter-meeting actions; sorted ascending. Last update: 2026-05-22.
export const FOMC_MEETING_DATES: string[] = [
  // 2000
  '2000-02-02','2000-03-21','2000-05-16','2000-06-28','2000-08-22','2000-10-03','2000-11-15','2000-12-19',
  // 2001 (incl. Jan 3, Apr 18, Sep 17, Oct 2 emergency)
  '2001-01-03','2001-01-31','2001-03-20','2001-04-18','2001-05-15','2001-06-27','2001-08-21',
  '2001-09-17','2001-10-02','2001-11-06','2001-12-11',
  // 2002
  '2002-01-30','2002-03-19','2002-05-07','2002-06-26','2002-08-13','2002-09-24','2002-11-06','2002-12-10',
  // 2003
  '2003-01-29','2003-03-18','2003-05-06','2003-06-25','2003-08-12','2003-09-16','2003-10-28','2003-12-09',
  // 2004
  '2004-01-28','2004-03-16','2004-05-04','2004-06-30','2004-08-10','2004-09-21','2004-11-10','2004-12-14',
  // 2005
  '2005-02-02','2005-03-22','2005-05-03','2005-06-30','2005-08-09','2005-09-20','2005-11-01','2005-12-13',
  // 2006
  '2006-01-31','2006-03-28','2006-05-10','2006-06-29','2006-08-08','2006-09-20','2006-10-25','2006-12-12',
  // 2007
  '2007-01-31','2007-03-21','2007-05-09','2007-06-28','2007-08-07','2007-09-18','2007-10-31','2007-12-11',
  // 2008 (incl. Jan 22, Oct 8 emergency)
  '2008-01-22','2008-01-30','2008-03-18','2008-04-30','2008-06-25','2008-08-05',
  '2008-09-16','2008-10-08','2008-10-29','2008-12-16',
  // 2009
  '2009-01-28','2009-03-18','2009-04-29','2009-06-24','2009-08-12','2009-09-23','2009-11-04','2009-12-16',
  // 2010
  '2010-01-27','2010-03-16','2010-04-28','2010-06-23','2010-08-10','2010-09-21','2010-11-03','2010-12-14',
  // 2011
  '2011-01-26','2011-03-15','2011-04-27','2011-06-22','2011-08-09','2011-09-21','2011-11-02','2011-12-13',
  // 2012
  '2012-01-25','2012-03-13','2012-04-25','2012-06-20','2012-08-01','2012-09-13','2012-10-24','2012-12-12',
  // 2013
  '2013-01-30','2013-03-20','2013-05-01','2013-06-19','2013-07-31','2013-09-18','2013-10-30','2013-12-18',
  // 2014
  '2014-01-29','2014-03-19','2014-04-30','2014-06-18','2014-07-30','2014-09-17','2014-10-29','2014-12-17',
  // 2015
  '2015-01-28','2015-03-18','2015-04-29','2015-06-17','2015-07-29','2015-09-17','2015-10-28','2015-12-16',
  // 2016
  '2016-01-27','2016-03-16','2016-04-27','2016-06-15','2016-07-27','2016-09-21','2016-11-02','2016-12-14',
  // 2017
  '2017-02-01','2017-03-15','2017-05-03','2017-06-14','2017-07-26','2017-09-20','2017-11-01','2017-12-13',
  // 2018
  '2018-01-31','2018-03-21','2018-05-02','2018-06-13','2018-08-01','2018-09-26','2018-11-08','2018-12-19',
  // 2019
  '2019-01-30','2019-03-20','2019-05-01','2019-06-19','2019-07-31','2019-09-18','2019-10-30','2019-12-11',
  // 2020 (incl. Mar 3, Mar 15 emergency)
  '2020-01-29','2020-03-03','2020-03-15','2020-04-29','2020-06-10','2020-07-29','2020-09-16','2020-11-05','2020-12-16',
  // 2021
  '2021-01-27','2021-03-17','2021-04-28','2021-06-16','2021-07-28','2021-09-22','2021-11-03','2021-12-15',
  // 2022
  '2022-01-26','2022-03-16','2022-05-04','2022-06-15','2022-07-27','2022-09-21','2022-11-02','2022-12-14',
  // 2023
  '2023-02-01','2023-03-22','2023-05-03','2023-06-14','2023-07-26','2023-09-20','2023-11-01','2023-12-13',
  // 2024
  '2024-01-31','2024-03-20','2024-05-01','2024-06-12','2024-07-31','2024-09-18','2024-11-07','2024-12-18',
  // 2025
  '2025-01-29','2025-03-19','2025-05-07','2025-06-18','2025-07-30','2025-09-17','2025-10-29','2025-12-10',
  // 2026 — past meetings
  '2026-01-28','2026-03-18','2026-04-29',
  // 2026 — upcoming meetings
  '2026-06-17','2026-07-29','2026-09-16','2026-10-28','2026-12-09',
];

// FOMC meetings that publish a Summary of Economic Projections (the "dot plot").
// The dot plot began at the January 2012 meeting and is released ~quarterly
// (March, June, September, December in the modern steady-state). Each date below
// is the statement-release day and is a member of FOMC_MEETING_DATES.
// Notes: 2012 started irregularly (Jan, then Apr/Jun/Sep/Dec). The March 2020
// SEP was cancelled (COVID), so 2020 has only Jun/Sep/Dec.
// Source: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
export const FOMC_DOT_PLOT_DATES: string[] = [
  '2012-01-25','2012-04-25','2012-06-20','2012-09-13','2012-12-12',
  '2013-03-20','2013-06-19','2013-09-18','2013-12-18',
  '2014-03-19','2014-06-18','2014-09-17','2014-12-17',
  '2015-03-18','2015-06-17','2015-09-17','2015-12-16',
  '2016-03-16','2016-06-15','2016-09-21','2016-12-14',
  '2017-03-15','2017-06-14','2017-09-20','2017-12-13',
  '2018-03-21','2018-06-13','2018-09-26','2018-12-19',
  '2019-03-20','2019-06-19','2019-09-18','2019-12-11',
  '2020-06-10','2020-09-16','2020-12-16', // March 2020 SEP cancelled (COVID)
  '2021-03-17','2021-06-16','2021-09-22','2021-12-15',
  '2022-03-16','2022-06-15','2022-09-21','2022-12-14',
  '2023-03-22','2023-06-14','2023-09-20','2023-12-13',
  '2024-03-20','2024-06-12','2024-09-18','2024-12-18',
  '2025-03-19','2025-06-18','2025-09-17','2025-12-10',
  '2026-03-18','2026-06-17','2026-09-16','2026-12-09',
];
export const FOMC_DOT_PLOT_SET = new Set(FOMC_DOT_PLOT_DATES);

// Federal Reserve chair change events — rendered as reference lines on the FOMC chart.
// `date`         = date the president publicly nominated this chair (market-moving event).
//                  For pre-modern chairs (pre-1970) this is the took-office date since
//                  nomination records are less precise.
// `firstMeeting` = date of the chair's first FOMC statement as chair.
// Source: https://en.wikipedia.org/wiki/Chair_of_the_Federal_Reserve
export const FED_CHAIR_CHANGES: { date: string; name: string; firstMeeting?: string }[] = [
  { date: '1914-08-10', name: 'Hamlin' },        // Charles S. Hamlin — took office
  { date: '1916-08-10', name: 'Harding' },       // W. P. G. Harding — took office
  { date: '1923-05-01', name: 'Crissinger' },    // Daniel R. Crissinger — took office
  { date: '1927-10-04', name: 'Young' },         // Roy A. Young — took office
  { date: '1930-09-16', name: 'Meyer' },         // Eugene Meyer — took office
  { date: '1933-05-19', name: 'Black' },         // Eugene R. Black — took office
  { date: '1934-11-15', name: 'Eccles' },        // Marriner S. Eccles — took office
  { date: '1948-04-15', name: 'McCabe' },        // Thomas B. McCabe — took office
  { date: '1951-04-02', name: 'Martin' },        // William McChesney Martin Jr. — took office
  { date: '1969-12-18', name: 'Burns',      firstMeeting: '1970-02-10' },  // nominated by Nixon 18 Dec 1969; confirmed 31 Jan 1970; 1st mtg 10 Feb 1970
  { date: '1978-01-21', name: 'Miller',     firstMeeting: '1978-03-21' },  // nominated by Carter 21 Jan 1978; took office 8 Mar 1978; 1st mtg 21 Mar 1978
  { date: '1979-07-25', name: 'Volcker',    firstMeeting: '1979-08-14' },  // nominated by Carter 25 Jul 1979; took office 6 Aug 1979; 1st mtg 14 Aug 1979
  { date: '1987-06-02', name: 'Greenspan',  firstMeeting: '1987-09-22' },  // nominated by Reagan 2 Jun 1987; confirmed 11 Aug 1987; 1st regular mtg 22 Sep 1987
  { date: '2005-10-24', name: 'Bernanke',   firstMeeting: '2006-03-28' },  // nominated by Bush Jr. 24 Oct 2005; took office 1 Feb 2006; 1st mtg 27–28 Mar 2006
  { date: '2013-10-09', name: 'Yellen',     firstMeeting: '2014-03-19' },  // nominated by Obama 9 Oct 2013; took office 3 Feb 2014; 1st mtg 18–19 Mar 2014
  { date: '2017-11-02', name: 'Powell',     firstMeeting: '2018-03-21' },  // nominated by Trump 2 Nov 2017; took office 5 Feb 2018; 1st mtg 20–21 Mar 2018
  { date: '2021-11-22', name: 'Powell (2nd)', firstMeeting: '2022-06-15' }, // renominated by Biden 22 Nov 2021; confirmed 12 May 2022; 2nd-term 1st mtg 15 Jun 2022
  { date: '2026-05-22', name: 'Warsh',      firstMeeting: '2026-06-17' },  // Kevin Warsh — took office 22 May 2026; 1st mtg 17 Jun 2026
];

// Bitcoin halving dates (exported so UI components can render them as reference lines).
export const BTC_HALVING_DATES: string[] = [
  '2012-11-28', // 1st: 50 → 25 BTC
  '2016-07-09', // 2nd: 25 → 12.5 BTC
  '2020-05-11', // 3rd: 12.5 → 6.25 BTC
  '2024-04-20', // 4th: 6.25 → 3.125 BTC
];

// Maps each per-category event indicator ID to its MarketEventCategory.
// Used by MacroSection, CompareChart, CompareSection to identify event overlays.
export const EVENT_INDICATOR_CATEGORY: Record<string, MarketEventCategory> = {
  'EVENTS_FINANCIAL':    'financial',
  'EVENTS_WAR':          'war',
  'EVENTS_TERRORISM':    'terrorism',
  'EVENTS_PANDEMIC':     'pandemic',
  'EVENTS_GEOPOLITICAL': 'geopolitical',
  'EVENTS_ELECTIONS':    'elections',
  'EVENTS_CRYPTO':       'crypto',
  'EVENTS_IPO':          'ipo',
  'EVENTS_PERSONAL':     'personal',
};

// Pure stock-market indices — Yahoo Finance native index symbols where they
// exist. MSCI World and MSCI EM IMI do not have reliable free price-index
// symbols on Yahoo Finance, so we use accumulating UCITS ETFs as proxies:
// they don't distribute dividends, so they behave like a price level in the UI
// (no DIV badge, no dividend distortion in returns).
export const INDEXES: AssetConfig[] = [
  { symbol: '^GSPC',     name: 'S&P 500',              category: 'USA',            region: 'America', type: 'index' },
  { symbol: '^NDX',      name: 'NASDAQ 100',            category: 'USA',            region: 'America', type: 'index' },
  { symbol: '^DJI',      name: 'Dow Jones',             category: 'USA',            region: 'America', type: 'index' },
  { symbol: '^RUT',      name: 'Russell 2000',          category: 'USA',            region: 'America', type: 'index' },
  { symbol: '^STOXX50E', name: 'Euro Stoxx 50',         category: 'Europe',         region: 'EU',      type: 'index' },
  { symbol: '^STOXX',    name: 'STOXX Europe 600',      category: 'Europe',         region: 'EU',      type: 'index' },
  { symbol: '^GDAXI',    name: 'DAX',                   category: 'Germany',        region: 'EU',      type: 'index' },
  { symbol: '^FTSE',     name: 'FTSE 100',              category: 'UK',             region: 'EU',      type: 'index' },
  { symbol: '^FCHI',     name: 'CAC 40',                category: 'France',         region: 'EU',      type: 'index' },
  // Global / EM — MSCI price-return indices (USD, no dividends)
  { symbol: '^990100-USD-STRD', name: 'MSCI World',          category: 'Global',         region: 'Global',  type: 'index' },
  { symbol: 'EIMI.L',          name: 'MSCI Emerg. Markets', category: 'Emerging',        region: 'EM',      type: 'etf'   },
  { symbol: '^N225',     name: 'Nikkei 225',            category: 'Japan',          region: 'Asia',    type: 'index' },
  { symbol: '^HSI',      name: 'Hang Seng',             category: 'Hong Kong',      region: 'Asia',    type: 'index' },
  { symbol: '000300.SS', name: 'CSI 300',               category: 'China',          region: 'Asia',    type: 'index' },
  { symbol: '^STI',      name: 'Straits Times (STI)',   category: 'Singapore',      region: 'Asia',    type: 'index' },
  { symbol: '^BSESN',    name: 'BSE Sensex',            category: 'India',          region: 'Asia',    type: 'index' },
  { symbol: '^KS11',     name: 'KOSPI',                 category: 'Korea',          region: 'Asia',    type: 'index' },
  { symbol: '^AXJO',     name: 'ASX 200',               category: 'Australia',      region: 'Asia',    type: 'index' },
  { symbol: '^GSPTSE',   name: 'TSX Composite',         category: 'Canada',         region: 'America', type: 'index' },
  { symbol: '^BVSP',     name: 'Bovespa',               category: 'Brazil',         region: 'America', type: 'index' },
];

export const COMMODITIES: AssetConfig[] = [
  { symbol: 'GC=F',  name: 'Gold',         category: 'Metals',  type: 'commodity' },
  { symbol: 'SI=F',  name: 'Silver',       category: 'Metals',  type: 'commodity' },
  { symbol: 'PL=F',  name: 'Platinum',     category: 'Metals',  type: 'commodity' },
  { symbol: 'PA=F',  name: 'Palladium',    category: 'Metals',  type: 'commodity' },
  { symbol: 'HG=F',  name: 'Copper',       category: 'Metals',  type: 'commodity' },
  { symbol: 'CL=F',  name: 'WTI Crude',    category: 'Energy',  type: 'commodity' },
  { symbol: 'BZ=F',  name: 'Brent Crude',  category: 'Energy',  type: 'commodity' },
  { symbol: 'NG=F',  name: 'Natural Gas',  category: 'Energy',  type: 'commodity' },
  { symbol: 'ZW=F',  name: 'Wheat',        category: 'Agri',    type: 'commodity' },
  { symbol: 'ZC=F',  name: 'Corn',         category: 'Agri',    type: 'commodity' },
  { symbol: 'ZS=F',  name: 'Soybeans',     category: 'Agri',    type: 'commodity' },
  { symbol: 'KC=F',  name: 'Coffee',       category: 'Softs',   type: 'commodity' },
  { symbol: 'SB=F',  name: 'Sugar',        category: 'Softs',   type: 'commodity' },
  { symbol: 'CC=F',  name: 'Cocoa',        category: 'Softs',   type: 'commodity' },
];

// `category` groups each coin by its primary market narrative. Used both for
// the Crypto section's filter tabs and the Compare quick-add subcategories, so
// the two always stay in sync.
export const CRYPTO_IDS: { id: string; symbol: string; name: string; category: string; startDate?: string }[] = [
  { id: 'bitcoin',          symbol: 'BTC', name: 'Bitcoin',    category: 'Store of Value' },
  { id: 'ethereum',         symbol: 'ETH', name: 'Ethereum',   category: 'Smart Contract' },
  { id: 'solana',           symbol: 'SOL', name: 'Solana',     category: 'Smart Contract' },
  { id: 'binancecoin',      symbol: 'BNB', name: 'BNB',        category: 'Exchange'       },
  { id: 'ripple',           symbol: 'XRP', name: 'XRP',        category: 'Payments'       },
  { id: 'cardano',          symbol: 'ADA', name: 'Cardano',    category: 'Smart Contract' },
  { id: 'avalanche-2',      symbol: 'AVAX',name: 'Avalanche',  category: 'Smart Contract' },
  { id: 'chainlink',        symbol: 'LINK',name: 'Chainlink',  category: 'DeFi'           },
  { id: 'dogecoin',         symbol: 'DOGE',name: 'Dogecoin',   category: 'Meme'           },
  { id: 'tron',             symbol: 'TRX', name: 'Tron',       category: 'Smart Contract' },
  { id: 'polkadot',         symbol: 'DOT', name: 'Polkadot',   category: 'Smart Contract' },
  { id: 'litecoin',         symbol: 'LTC', name: 'Litecoin',   category: 'Payments'       },
  { id: 'sui',              symbol: 'SUI', name: 'Sui',        category: 'Smart Contract' },
  { id: 'zcash',            symbol: 'ZEC', name: 'Zcash',      category: 'Privacy'        },
  { id: 'ondo-finance',     symbol: 'ONDO',name: 'Ondo',       category: 'DeFi'           },
];

export const CRYPTO_YAHOO_SYMBOLS: Record<string, string> = {
  bitcoin:     'BTC-USD',
  ethereum:    'ETH-USD',
  solana:      'SOL-USD',
  binancecoin: 'BNB-USD',
  ripple:      'XRP-USD',
  cardano:     'ADA-USD',
  'avalanche-2':'AVAX-USD',
  chainlink:   'LINK-USD',
  dogecoin:    'DOGE-USD',
  tron:        'TRX-USD',
  polkadot:    'DOT-USD',
  litecoin:    'LTC-USD',
  sui:         'SUI-USD',
  zcash:       'ZEC-USD',
  'ondo-finance': 'ONDO-USD',
};

export const SECTORS: AssetConfig[] = [
  { symbol: 'XLK',   name: 'Technology',             category: 'Tech',       type: 'sector' },
  { symbol: 'SOXX',  name: 'Semiconductors',          category: 'Tech',       type: 'sector' },
  { symbol: 'AIQ',   name: 'AI & Machine Learning',   category: 'Tech',       type: 'sector' },
  { symbol: 'WCLD',  name: 'Cloud Computing',         category: 'Tech',       type: 'sector' },
  { symbol: 'CIBR',  name: 'Cybersecurity',           category: 'Tech',       type: 'sector' },
  { symbol: 'MAGS',  name: 'Magnificent Seven',       category: 'Tech',       type: 'sector' },
  { symbol: 'XLV',   name: 'Healthcare',              category: 'Health',     type: 'sector' },
  { symbol: 'XBI',   name: 'Biotech & Pharma',        category: 'Health',     type: 'sector' },
  { symbol: 'XLF',   name: 'Financials',              category: 'Finance',    type: 'sector' },
  { symbol: 'EXV1.DE',name: 'EU Banks (STOXX 600)',   category: 'Finance',    type: 'sector' },
  { symbol: 'BITQ',  name: 'Crypto & Digital Payments',category: 'Crypto',    type: 'sector' },
  { symbol: 'XLY',   name: 'Consumer Discr.',         category: 'Consumer',   type: 'sector' },
  { symbol: 'XLP',   name: 'Consumer Staples',        category: 'Consumer',   type: 'sector' },
  { symbol: 'XLE',   name: 'Energy & Utilities',      category: 'Energy',     type: 'sector' },
  { symbol: 'NLR',   name: 'Nuclear & Uranium',       category: 'Energy',     type: 'sector' },
  { symbol: 'ICLN',  name: 'Clean Energy',            category: 'Energy',     type: 'sector' },
  { symbol: 'XLI',   name: 'Industrials',             category: 'Industrial', type: 'sector' },
  { symbol: 'ITA',   name: 'Defense & Aerospace',     category: 'Industrial', type: 'sector' },
  { symbol: 'BOTZ',  name: 'Robotics & Automation',   category: 'Industrial', type: 'sector' },
  { symbol: 'DRIV',  name: 'Electric Vehicles',       category: 'EV',         type: 'sector' },
  { symbol: 'XLB',   name: 'Materials',               category: 'Materials',  type: 'sector' },
  { symbol: 'XLRE',  name: 'Real Estate (US)',        category: 'Real Estate',type: 'sector' },
  { symbol: 'IYR',   name: 'iShares US Real Estate',  category: 'Real Estate',type: 'sector' },
  { symbol: 'IPRP.AS',name: 'iShares EU Property Yield',category: 'Real Estate',type: 'sector' },
  { symbol: 'IUKP.L',name: 'iShares UK Property',     category: 'Real Estate',type: 'sector' },
  { symbol: 'BIZD',  name: 'BDC Income (VanEck)',     category: 'BDC',        type: 'sector' },
  { symbol: 'NANC',  name: 'Dem. Politicians (NANC)', category: 'Politics',   type: 'sector' },
  { symbol: 'GOP',   name: 'Rep. Politicians (GOP)',  category: 'Politics',   type: 'sector' },
  { symbol: 'XLU',   name: 'Utilities',               category: 'Utilities',  type: 'sector' },
  // US Treasuries — USD-listed on NYSE (NAV in USD)
  { symbol: 'SHY',   name: 'US Treasury 1-3yr',       category: 'Bonds',      type: 'sector' },
  { symbol: 'IEF',   name: 'US Treasury 7-10yr',      category: 'Bonds',      type: 'sector' },
  { symbol: 'TLT',   name: 'US Treasury 20+yr',       category: 'Bonds',      type: 'sector' },
  // EU Government Bonds — EUR-listed on Euronext Amsterdam (NAV in EUR)
  { symbol: 'IBGS.AS',name: 'EU Govt Bond 1-3yr',     category: 'Bonds',      type: 'sector' },
  { symbol: 'IBGM.AS',name: 'EU Govt Bond 7-10yr',    category: 'Bonds',      type: 'sector' },
  { symbol: 'IBGL.AS',name: 'EU Govt Bond 15-30yr',   category: 'Bonds',      type: 'sector' },
];

// Reverse map: Yahoo crypto symbol (e.g. "BTC-USD") → CoinGecko id (e.g. "bitcoin").
// Built the SAME way Rotation builds its crypto symbols, so the lookup always hits.
const CRYPTO_YAHOO_TO_ID: Record<string, string> = Object.fromEntries(
  CRYPTO_IDS.map(e => [CRYPTO_YAHOO_SYMBOLS[e.id] ?? `${e.symbol}-USD`, e.id]),
);

// Translate a Rotation/Backtest asset (group + its Yahoo symbol/ticker) into the
// navigation target the destination section expects. Crypto needs `crypto:<id>`
// and Stocks need `stock:<ticker>`; the rest match on their raw config symbol.
// This is why clicking a crypto or stock row "sometimes" didn't open before — the
// raw Yahoo symbol never matched those sections' prefixed jumpTo format.
export function assetNavTarget(group: string, symbol: string): { section: string; jumpTo: string } {
  switch (group) {
    case 'Crypto': {
      const id = CRYPTO_YAHOO_TO_ID[symbol];
      return { section: 'crypto', jumpTo: id ? `crypto:${id}` : `crypto:${symbol}` };
    }
    case 'Stocks':      return { section: 'stock',       jumpTo: `stock:${symbol}` };
    case 'Commodities': return { section: 'commodities', jumpTo: symbol };
    case 'Sectors':     return { section: 'sectors',     jumpTo: symbol };
    case 'Indexes':
    default:            return { section: 'indexes',     jumpTo: symbol };
  }
}

// Currency metadata — flag emoji + ISO-3166 country code + full name, keyed by
// ISO currency code. `cc` is used to load a real flag image (emoji flags don't
// render on Windows).
export const CURRENCY_META: Record<string, { name: string; flag: string; cc: string }> = {
  USD: { name: 'US Dollar',          flag: '🇺🇸', cc: 'us' },
  EUR: { name: 'Euro',               flag: '🇪🇺', cc: 'eu' },
  GBP: { name: 'British Pound',      flag: '🇬🇧', cc: 'gb' },
  JPY: { name: 'Japanese Yen',       flag: '🇯🇵', cc: 'jp' },
  CHF: { name: 'Swiss Franc',        flag: '🇨🇭', cc: 'ch' },
  AUD: { name: 'Australian Dollar',  flag: '🇦🇺', cc: 'au' },
  CAD: { name: 'Canadian Dollar',    flag: '🇨🇦', cc: 'ca' },
  NZD: { name: 'New Zealand Dollar', flag: '🇳🇿', cc: 'nz' },
  CNY: { name: 'Chinese Yuan',       flag: '🇨🇳', cc: 'cn' },
  INR: { name: 'Indian Rupee',       flag: '🇮🇳', cc: 'in' },
  MXN: { name: 'Mexican Peso',       flag: '🇲🇽', cc: 'mx' },
  BRL: { name: 'Brazilian Real',     flag: '🇧🇷', cc: 'br' },
  SEK: { name: 'Swedish Krona',      flag: '🇸🇪', cc: 'se' },
};

// Each group is shown as one card with BOTH directions (base→quote and the
// inverse quote→base). Only USD- and EUR-based pairs are tracked — the base
// currency is always USD or EUR so it leads in the card layout.
// `region` reflects the non-USD, non-EUR currency's geography (used for
// filter tabs in the Currencies section and Compare bulk-add).
export const CURRENCY_GROUPS: { base: string; quote: string; region: string }[] = [
  { base: 'EUR', quote: 'USD', region: 'EU' },       // EUR = European
  { base: 'USD', quote: 'GBP', region: 'EU' },
  { base: 'USD', quote: 'JPY', region: 'Asia' },
  { base: 'USD', quote: 'CHF', region: 'EU' },
  { base: 'USD', quote: 'CNY', region: 'Asia' },
  { base: 'USD', quote: 'CAD', region: 'America' },
  { base: 'USD', quote: 'AUD', region: 'Asia' },
  { base: 'USD', quote: 'NZD', region: 'Asia' },
  { base: 'USD', quote: 'MXN', region: 'EM' },
  { base: 'USD', quote: 'INR', region: 'EM' },
  { base: 'USD', quote: 'BRL', region: 'EM' },
  { base: 'USD', quote: 'SEK', region: 'EU' },
  { base: 'EUR', quote: 'GBP', region: 'EU' },
  { base: 'EUR', quote: 'JPY', region: 'Asia' },
  { base: 'EUR', quote: 'CHF', region: 'EU' },
  { base: 'EUR', quote: 'CNY', region: 'Asia' },
  { base: 'EUR', quote: 'CAD', region: 'America' },
  { base: 'EUR', quote: 'AUD', region: 'Asia' },
  { base: 'EUR', quote: 'NZD', region: 'Asia' },
  { base: 'EUR', quote: 'MXN', region: 'EM' },
  { base: 'EUR', quote: 'INR', region: 'EM' },
  { base: 'EUR', quote: 'BRL', region: 'EM' },
  { base: 'EUR', quote: 'SEK', region: 'EU' },
];

// Flat list of every pair direction (used by the Compare section and note
// validation). Derived from CURRENCY_GROUPS so both directions always exist.
export const CURRENCY_PAIRS = CURRENCY_GROUPS.flatMap(g => [
  { from: g.base,  to: g.quote, symbol: `${g.base}${g.quote}=X` },
  { from: g.quote, to: g.base,  symbol: `${g.quote}${g.base}=X` },
]);

export const ALL_COMPARABLE_ASSETS = [
  ...INDEXES.map(a => ({ ...a, group: 'Indexes' })),
  ...COMMODITIES.map(a => ({ ...a, group: 'Commodities' })),
  ...CRYPTO_IDS.map(a => ({ symbol: `${a.symbol}-USD`, name: a.name, category: 'Crypto', type: 'crypto' as const, group: 'Crypto' })),
  ...SECTORS.map(a => ({ ...a, group: 'Sectors' })),
  ...MACRO_INDICATORS.map(m => ({ symbol: m.id, name: m.name, category: m.category, type: 'macro' as const, group: 'Macro' })),
  ...CURRENCY_PAIRS.map(c => ({
    symbol: c.symbol,
    name: `${c.from}/${c.to}`,
    category: 'FX',
    type: 'currency' as const,
    group: 'FX',
  })),
];

// ─────────────────────────────────────────────────────────────────────────────
// COMPARE QUICK-ADD ASSET CLASSES
// Each asset class exposes the SAME subcategories its own section uses, derived
// directly from the config above — so a new sector / macro category / crypto
// narrative shows up in Compare automatically, with no second list to maintain.
// Clicking a subcategory bulk-loads its assets into the comparison.
// The "Stocks" class is built at runtime from the user's note categories (see
// CompareSection), since stocks have no fixed config list.
// ─────────────────────────────────────────────────────────────────────────────
export interface CompareSubcat { label: string; symbols: string[] }
export interface CompareClass { key: string; label: string; subcats: CompareSubcat[] }

// Distinct values in first-seen order.
function uniqOrder<T>(xs: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of xs) if (!seen.has(x)) { seen.add(x); out.push(x); }
  return out;
}

// Prepend an "All" subcategory holding every symbol of the class.
function withAll(all: string[], subcats: CompareSubcat[]): CompareSubcat[] {
  return [{ label: 'All', symbols: all }, ...subcats];
}

const fxSymbol = (g: { base: string; quote: string }) => `${g.base}${g.quote}=X`;

export const COMPARE_ASSET_CLASSES: CompareClass[] = [
  {
    key: 'Indexes', label: 'Indexes',
    subcats: withAll(
      INDEXES.map(i => i.symbol),
      uniqOrder(INDEXES.map(i => i.region ?? i.category)).map(region => ({
        label: region!,
        symbols: INDEXES.filter(i => (i.region ?? i.category) === region).map(i => i.symbol),
      })),
    ),
  },
  {
    key: 'Currency', label: 'Currency',
    subcats: withAll(
      CURRENCY_GROUPS.map(fxSymbol),
      [
        { label: 'USD', symbols: CURRENCY_GROUPS.filter(g => g.base === 'USD').map(fxSymbol) },
        { label: 'EUR', symbols: CURRENCY_GROUPS.filter(g => g.base === 'EUR').map(fxSymbol) },
        ...uniqOrder(CURRENCY_GROUPS.map(g => g.region)).map(region => ({
          label: region,
          symbols: CURRENCY_GROUPS.filter(g => g.region === region).map(fxSymbol),
        })),
      ],
    ),
  },
  {
    key: 'Crypto', label: 'Crypto',
    subcats: withAll(
      CRYPTO_IDS.map(c => `${c.symbol}-USD`),
      uniqOrder(CRYPTO_IDS.map(c => c.category)).map(cat => ({
        label: cat,
        symbols: CRYPTO_IDS.filter(c => c.category === cat).map(c => `${c.symbol}-USD`),
      })),
    ),
  },
  {
    key: 'Commodities', label: 'Commodities',
    subcats: withAll(
      COMMODITIES.map(c => c.symbol),
      uniqOrder(COMMODITIES.map(c => c.category)).map(cat => ({
        label: cat,
        symbols: COMMODITIES.filter(c => c.category === cat).map(c => c.symbol),
      })),
    ),
  },
  {
    key: 'Sectors', label: 'Sectors',
    subcats: withAll(
      SECTORS.map(s => s.symbol),
      uniqOrder(SECTORS.map(s => s.category)).map(cat => ({
        label: cat,
        symbols: SECTORS.filter(s => s.category === cat).map(s => s.symbol),
      })),
    ),
  },
  {
    key: 'Macro', label: 'Macro',
    // Every macro category that has at least one indicator, in config order.
    subcats: uniqOrder(MACRO_INDICATORS.map(m => m.category)).map(cat => ({
      label: cat,
      symbols: MACRO_INDICATORS.filter(m => m.category === cat).map(m => m.id),
    })),
  },
];
