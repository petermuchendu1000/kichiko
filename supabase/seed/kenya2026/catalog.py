"""
Kichiko — Kenya 2026 researched market catalog (single source of truth).

All content is grounded in live July-2026 reporting (Gachagua impeachment + DCP,
Finance Bill 2026 / Tax Amendments Bill, AFCON 2027 co-hosting, Arbantone music
wave, BTC ~$66k, Housing Levy anger, inflation ~6.7%). Titles are deliberately
SHORT and explicit (Polymarket style). Probabilities are the seeder's initial
"house" priors (a quant's honest read), not certainties.

Image strategy — every market cover and every multi-outcome option carries an
(entity_kind, entity_ref) that the backfill resolver can ALWAYS fetch:
  person  -> Wikipedia page title      (photo)
  company -> primary domain            (favicon/logo)
  crypto  -> CoinGecko coin id         (token mark)
  place   -> ISO-3166-1 alpha-2        (flag)
No abstract/unimageable options are used, so there are no placeholders.

NOW = 2026-07-23 (EAT). Dates below are chosen to be live (open) markets that
resolve between Aug 2026 and Aug 2027, plus a few already-resolved ones so the
"Closed/Resolved" surfaces are populated.
"""

# Reusable entity refs (deduped downstream so each image is fetched once)
P = "person"; C = "company"; X = "crypto"; F = "place"

MARKETS = [
    # ==================== POLITICS & ELECTIONS ====================
    {
        "slug": "ke-2027-president",
        "title": "Who wins Kenya's 2027 presidency?",
        "desc": "Kenya's next general election is due in August 2027. Ruto seeks a second term while a fragmenting opposition hunts for a single flagbearer.",
        "category": "elections", "rtype": "multiple_choice",
        "criteria": "Resolves to the candidate declared President-elect by the IEBC for the 2027 General Election, after any Supreme Court petition.",
        "closes": "2027-08-08", "resolves": "2027-09-10",
        "tags": ["kenya","2027","president","elections"],
        "cover": (P, "William Ruto"), "featured": True, "trending": True,
        "options": [
            ("William Ruto", P, "William Ruto", 0.43),
            ("Rigathi Gachagua", P, "Rigathi Gachagua", 0.22),
            ("Kalonzo Musyoka", P, "Kalonzo Musyoka", 0.13),
            ("Fred Matiang'i", P, "Fred Matiang'i", 0.12),
            ("Musalia Mudavadi", P, "Musalia Mudavadi", 0.05),
        ],
    },
    {
        "slug": "ke-gachagua-on-ballot-2027",
        "title": "Gachagua on the 2027 ballot?",
        "desc": "The High Court upheld Rigathi Gachagua's impeachment on 8 June 2026; his appeal is pending. Eligibility hinges on the courts.",
        "category": "politics", "rtype": "binary",
        "criteria": "Resolves YES if Rigathi Gachagua is cleared by the IEBC as a presidential candidate for the 2027 General Election.",
        "closes": "2027-06-30", "resolves": "2027-07-15",
        "tags": ["kenya","gachagua","impeachment","2027"],
        "cover": (P, "Rigathi Gachagua"), "featured": True, "trending": True, "yes": 0.55,
    },
    {
        "slug": "ke-ruto-reelection-2027",
        "title": "Ruto wins re-election in 2027?",
        "desc": "President William Ruto is defending State House amid cost-of-living anger and a resurgent Gen-Z movement.",
        "category": "politics", "rtype": "binary",
        "criteria": "Resolves YES if William Ruto is declared winner of the 2027 presidential election by the IEBC.",
        "closes": "2027-08-08", "resolves": "2027-09-10",
        "tags": ["kenya","ruto","2027","reelection"],
        "cover": (P, "William Ruto"), "featured": True, "trending": True, "yes": 0.44,
    },
    {
        "slug": "ke-gachagua-appeal-upheld",
        "title": "Gachagua impeachment upheld on appeal?",
        "desc": "Gachagua's team has appealed the High Court decision that confirmed his removal as Deputy President.",
        "category": "politics", "rtype": "binary",
        "criteria": "Resolves YES if the appellate courts uphold the impeachment (removal stands) in a final ruling.",
        "closes": "2027-03-31", "resolves": "2027-04-15",
        "tags": ["kenya","gachagua","court","impeachment"],
        "cover": (P, "Rigathi Gachagua"), "trending": True, "yes": 0.5,
    },
    {
        "slug": "ke-2027-opposition-flagbearer",
        "title": "Opposition flagbearer for 2027?",
        "desc": "The united opposition is racing to settle on one candidate to face Ruto. DCP, Wiper and allies are in talks.",
        "category": "elections", "rtype": "multiple_choice",
        "criteria": "Resolves to the person unveiled as the joint opposition presidential flagbearer for 2027 (major-media confirmed).",
        "closes": "2027-04-30", "resolves": "2027-05-15",
        "tags": ["kenya","opposition","2027","dcp"],
        "cover": (P, "Rigathi Gachagua"), "featured": True,
        "options": [
            ("Rigathi Gachagua", P, "Rigathi Gachagua", 0.40),
            ("Kalonzo Musyoka", P, "Kalonzo Musyoka", 0.24),
            ("Fred Matiang'i", P, "Fred Matiang'i", 0.20),
            ("Martha Karua", P, "Martha Karua", 0.10),
            ("Eugene Wamalwa", P, "Eugene Wamalwa", 0.06),
        ],
    },
    {
        "slug": "ke-ruto-gachagua-reconcile",
        "title": "Ruto & Gachagua reconcile before 2027?",
        "desc": "Gachagua has publicly dismissed reconciliation with Ruto, but Kenyan politics is fluid.",
        "category": "politics", "rtype": "binary",
        "criteria": "Resolves YES if Ruto and Gachagua appear jointly at a political event signalling a formal truce before the 2027 vote.",
        "closes": "2027-06-30", "resolves": "2027-07-05",
        "tags": ["kenya","ruto","gachagua","politics"],
        "cover": (P, "William Ruto"), "yes": 0.12,
    },
    {
        "slug": "ke-dcp-100-mps-2027",
        "title": "DCP wins 100+ MPs in 2027?",
        "desc": "Gachagua's Democracy for Citizens Party is targeting ~130 parliamentary seats after its Ol Kalou by-election win.",
        "category": "elections", "rtype": "binary",
        "criteria": "Resolves YES if DCP wins 100 or more National Assembly seats in the 2027 General Election.",
        "closes": "2027-08-08", "resolves": "2027-09-01",
        "tags": ["kenya","dcp","parliament","2027"],
        "cover": (P, "Rigathi Gachagua"), "yes": 0.3,
    },
    {
        "slug": "ke-sakaja-reelection-2027",
        "title": "Sakaja wins re-election as Nairobi Governor?",
        "desc": "Johnson Sakaja defends City Hall in Kenya's marquee county race against a crowded 2027 field.",
        "category": "elections", "rtype": "binary",
        "criteria": "Resolves YES if Johnson Sakaja is declared Governor of Nairobi County by the IEBC after the 2027 election.",
        "closes": "2027-08-08", "resolves": "2027-08-25",
        "tags": ["kenya","nairobi","governor","2027"],
        "cover": (P, "Johnson Sakaja"), "trending": True, "yes": 0.47,
    },
    {
        "slug": "ke-tax-amendments-bill-2026",
        "title": "Tax Amendments Bill passed by Dec 2026?",
        "desc": "Treasury CS John Mbadi plans a September 2026 bill to cut PAYE and lift the tax-free threshold to Sh30,000.",
        "category": "governance", "rtype": "binary",
        "criteria": "Resolves YES if the Tax (Amendment) Bill 2026 is assented into law on or before 31 December 2026.",
        "closes": "2026-12-31", "resolves": "2027-01-05",
        "tags": ["kenya","tax","treasury","paye"],
        "cover": (F, "ke"), "yes": 0.6,
    },
    {
        "slug": "ke-finance-bill-protests-2026",
        "title": "Finance Bill sparks protests in 5+ counties?",
        "desc": "The Finance Bill 2026 aims to raise ~Sh100bn in new taxes, echoing the 2024 trigger for nationwide unrest.",
        "category": "social", "rtype": "binary",
        "criteria": "Resolves YES if coordinated anti-tax protests are reported in 5 or more counties on the same day in 2026 (major-media).",
        "closes": "2026-12-31", "resolves": "2027-01-10",
        "tags": ["kenya","protests","financebill","genz"],
        "cover": (F, "ke"), "trending": True, "yes": 0.58,
    },

    # ==================== ECONOMICS ====================
    {
        "slug": "ke-kes-weaker-135-2026",
        "title": "KES weaker than 135/USD by Dec 2026?",
        "desc": "The shilling has been broadly stable near 129/USD, but a widening current-account deficit and oil at $85 add pressure.",
        "category": "economics", "rtype": "binary",
        "criteria": "Resolves YES if the CBK indicative KES/USD mean rate closes at 135.00 or weaker on any day in December 2026.",
        "closes": "2026-12-31", "resolves": "2027-01-03",
        "tags": ["kenya","shilling","forex","kes"],
        "cover": (F, "ke"), "yes": 0.32,
    },
    {
        "slug": "ke-inflation-above-7-2026",
        "title": "Kenya inflation above 7% in 2026?",
        "desc": "12-month CPI inflation rose to 6.68% in May 2026, nearing the top of the CBK 2.5–7.5% band.",
        "category": "economics", "rtype": "binary",
        "criteria": "Resolves YES if KNBS reports 12-month inflation above 7.0% for any month of 2026.",
        "closes": "2026-12-31", "resolves": "2027-01-15",
        "tags": ["kenya","inflation","cpi","cbk"],
        "cover": (F, "ke"), "trending": True, "yes": 0.4,
    },
    {
        "slug": "ke-cbr-below-9-2026",
        "title": "CBK cuts base rate below 9% in 2026?",
        "desc": "With T-bills easing and credit growth recovering, markets debate how far the CBK cuts.",
        "category": "economics", "rtype": "binary",
        "criteria": "Resolves YES if the CBK Central Bank Rate is set below 9.00% at any MPC meeting in 2026.",
        "closes": "2026-12-31", "resolves": "2027-01-10",
        "tags": ["kenya","cbk","rates","mpc"],
        "cover": (F, "ke"), "yes": 0.55,
    },
    {
        "slug": "ke-scom-above-30-2026",
        "title": "Safaricom above KES 30 by Dec 2026?",
        "desc": "Safaricom (NSE: SCOM) is Kenya's most valuable listed firm; its recovery drives the whole NSE.",
        "category": "business", "rtype": "binary",
        "criteria": "Resolves YES if SCOM closes at or above KES 30.00 on any NSE trading day in December 2026.",
        "closes": "2026-12-31", "resolves": "2027-01-05",
        "tags": ["kenya","safaricom","nse","stocks"],
        "cover": (C, "safaricom.co.ke"), "yes": 0.47,
    },
    {
        "slug": "ke-nse-biggest-gainer-h2-2026",
        "title": "Biggest NSE blue-chip gainer, H2 2026?",
        "desc": "Which large-cap posts the best share-price return over July–December 2026?",
        "category": "business", "rtype": "multiple_choice",
        "criteria": "Resolves to the stock with the highest percentage price gain from 1 Jul to 31 Dec 2026 (NSE close).",
        "closes": "2026-12-31", "resolves": "2027-01-08",
        "tags": ["kenya","nse","stocks","blue-chip"],
        "cover": (C, "safaricom.co.ke"),
        "options": [
            ("Safaricom", C, "safaricom.co.ke", 0.34),
            ("Equity Group", C, "equitygroupholdings.com", 0.26),
            ("EABL", C, "eabl.com", 0.22),
            ("Co-op Bank", C, "co-opbank.co.ke", 0.18),
        ],
    },
    {
        "slug": "ke-kq-profit-2026",
        "title": "Kenya Airways profitable in FY2026?",
        "desc": "KQ returned to the black recently; sustaining profit amid fuel costs is the question.",
        "category": "business", "rtype": "binary",
        "criteria": "Resolves YES if Kenya Airways reports a positive net profit after tax for financial year 2026.",
        "closes": "2027-03-31", "resolves": "2027-04-30",
        "tags": ["kenya","kq","airline","earnings"],
        "cover": (C, "kenya-airways.com"), "yes": 0.5,
    },

    # ==================== CRYPTO ====================
    {
        "slug": "btc-above-75k-2026",
        "title": "Bitcoin above $75k in 2026?",
        "desc": "BTC trades near $66k in late July 2026, held back by an oil-driven inflation scare and a strong dollar.",
        "category": "crypto", "rtype": "binary",
        "criteria": "Resolves YES if BTC/USD (Coinbase spot) trades at or above $75,000 at any point before 2026-12-31 23:59 UTC.",
        "closes": "2026-12-31", "resolves": "2027-01-02",
        "tags": ["bitcoin","btc","crypto"],
        "cover": (X, "bitcoin"), "featured": True, "trending": True, "yes": 0.38,
    },
    {
        "slug": "btc-below-60k-q3-2026",
        "title": "Bitcoin below $60k before Oct 2026?",
        "desc": "Profit-taking and macro risk-off flows keep a floor test in play.",
        "category": "crypto", "rtype": "binary",
        "criteria": "Resolves YES if BTC/USD (Coinbase spot) trades at or below $60,000 at any point before 2026-10-01 00:00 UTC.",
        "closes": "2026-09-30", "resolves": "2026-10-01",
        "tags": ["bitcoin","btc","crypto"],
        "cover": (X, "bitcoin"), "yes": 0.45,
    },
    {
        "slug": "eth-above-2500-2026",
        "title": "Ethereum above $2,500 in 2026?",
        "desc": "ETH sits near $1,930, with the 200-day average around $2,190 as resistance.",
        "category": "crypto", "rtype": "binary",
        "criteria": "Resolves YES if ETH/USD (Coinbase spot) trades at or above $2,500 at any point before 2026-12-31 23:59 UTC.",
        "closes": "2026-12-31", "resolves": "2027-01-02",
        "tags": ["ethereum","eth","crypto"],
        "cover": (X, "ethereum"), "trending": True, "yes": 0.35,
    },
    {
        "slug": "crypto-best-performer-h2-2026",
        "title": "Best major crypto in H2 2026?",
        "desc": "Which top asset posts the highest USD return from July to December 2026?",
        "category": "crypto", "rtype": "multiple_choice",
        "criteria": "Resolves to the asset with the highest percentage USD return from 1 Jul to 31 Dec 2026 (Coinbase close).",
        "closes": "2026-12-31", "resolves": "2027-01-03",
        "tags": ["crypto","bitcoin","ethereum","solana","xrp"],
        "cover": (X, "bitcoin"), "featured": True,
        "options": [
            ("Bitcoin", X, "bitcoin", 0.34),
            ("Ethereum", X, "ethereum", 0.26),
            ("Solana", X, "solana", 0.24),
            ("XRP", X, "ripple", 0.16),
        ],
    },
    {
        "slug": "xrp-above-2-2026",
        "title": "XRP above $2 in 2026?",
        "desc": "XRP holds support near $1.13; a break above $2 needs a clear risk-on turn.",
        "category": "crypto", "rtype": "binary",
        "criteria": "Resolves YES if XRP/USD (Coinbase spot) trades at or above $2.00 at any point before 2026-12-31 23:59 UTC.",
        "closes": "2026-12-31", "resolves": "2027-01-02",
        "tags": ["xrp","ripple","crypto"],
        "cover": (X, "ripple"), "yes": 0.28,
    },

    # ==================== SPORTS ====================
    {
        "slug": "afcon-2027-winner",
        "title": "AFCON 2027 winner?",
        "desc": "The 2027 Africa Cup of Nations is co-hosted by Kenya, Tanzania and Uganda. Favourites gather.",
        "category": "sports", "rtype": "multiple_choice",
        "criteria": "Resolves to the national team that wins the AFCON 2027 final.",
        "closes": "2027-01-15", "resolves": "2027-02-15",
        "tags": ["afcon","2027","football","africa"],
        "cover": (F, "ma"), "featured": True, "trending": True,
        "options": [
            ("Morocco", F, "ma", 0.26),
            ("Senegal", F, "sn", 0.20),
            ("Egypt", F, "eg", 0.16),
            ("Ivory Coast", F, "ci", 0.14),
            ("Nigeria", F, "ng", 0.14),
            ("Kenya", F, "ke", 0.10),
        ],
    },
    {
        "slug": "ke-afcon-2027-group-exit",
        "title": "Kenya out in AFCON 2027 group stage?",
        "desc": "As co-hosts under Benni McCarthy, Harambee Stars carry huge home expectations.",
        "category": "sports", "rtype": "binary",
        "criteria": "Resolves YES if Kenya fails to advance from the group stage at AFCON 2027.",
        "closes": "2027-01-05", "resolves": "2027-01-20",
        "tags": ["kenya","harambee-stars","afcon","2027"],
        "cover": (F, "ke"), "trending": True, "yes": 0.5,
    },
    {
        "slug": "ke-beat-southafrica-qualifier",
        "title": "Kenya beat South Africa at home in qualifier?",
        "desc": "Kenya's AFCON 2027 qualifying group pits them against South Africa, Guinea and Eritrea.",
        "category": "sports", "rtype": "binary",
        "criteria": "Resolves YES if Kenya wins its home AFCON-qualifier fixture against South Africa (Sept–Nov 2026 window).",
        "closes": "2026-11-30", "resolves": "2026-12-02",
        "tags": ["kenya","southafrica","qualifier","football"],
        "cover": (F, "ke"), "yes": 0.42,
    },
    {
        "slug": "ke-talanta-stadium-ready",
        "title": "Talanta Stadium ready for AFCON 2027?",
        "desc": "The 60,000-seat Talanta Sports City is Kenya's flagship AFCON venue.",
        "category": "sports", "rtype": "binary",
        "criteria": "Resolves YES if Talanta Stadium is officially handed over / CAF-inspected as match-ready before 31 Dec 2026.",
        "closes": "2026-12-31", "resolves": "2027-01-10",
        "tags": ["kenya","talanta","stadium","afcon"],
        "cover": (F, "ke"), "yes": 0.62,
    },
    {
        "slug": "ke-berlin-marathon-2026",
        "title": "Kenyan wins 2026 Berlin Marathon?",
        "desc": "Kenya has long dominated the majors; Berlin is a favourite for world records.",
        "category": "sports", "rtype": "binary",
        "criteria": "Resolves YES if a Kenyan-passport athlete wins the elite men's or women's race at the 2026 Berlin Marathon.",
        "closes": "2026-09-27", "resolves": "2026-09-29",
        "tags": ["kenya","marathon","athletics","berlin"],
        "cover": (F, "ke"), "yes": 0.72,
    },

    # ==================== ENTERTAINMENT ====================
    {
        "slug": "ke-artist-of-year-2026",
        "title": "Kenya's artist of the year 2026?",
        "desc": "The Arbantone wave (evolved Gengetone) dominates Nairobi's Gen-Z streams. Who tops 2026?",
        "category": "entertainment", "rtype": "multiple_choice",
        "criteria": "Resolves to the act crowned Artist/Song of the Year at the leading 2026 Kenyan music awards (or most-streamed Kenyan act, if no ceremony).",
        "closes": "2026-12-31", "resolves": "2027-02-28",
        "tags": ["kenya","music","arbantone","gengetone"],
        "cover": (P, "Nyashinski"), "trending": True,
        "options": [
            ("Khaligraph Jones", P, "Khaligraph Jones", 0.30),
            ("Nyashinski", P, "Nyashinski", 0.28),
            ("Sauti Sol", P, "Sauti Sol", 0.24),
            ("Akothee", P, "Akothee", 0.18),
        ],
    },
    {
        "slug": "ke-arbantone-10m-youtube-2026",
        "title": "Arbantone song hits 10M YouTube views in 2026?",
        "desc": "TikTok-fuelled Arbantone hits are climbing fast; a 10M-view single would mark mainstream arrival.",
        "category": "entertainment", "rtype": "binary",
        "criteria": "Resolves YES if any Arbantone/Gengetone single released in 2026 surpasses 10,000,000 YouTube views before 31 Dec 2026.",
        "closes": "2026-12-31", "resolves": "2027-01-07",
        "tags": ["kenya","arbantone","youtube","music"],
        "cover": (C, "youtube.com"), "yes": 0.6,
    },

    # ==================== TECHNOLOGY / BUSINESS ====================
    {
        "slug": "ke-mpesa-35m-users-2026",
        "title": "M-Pesa tops 35M active users in 2026?",
        "desc": "M-Pesa is the backbone of Kenya's economy; Safaricom reports active-user counts quarterly.",
        "category": "technology", "rtype": "binary",
        "criteria": "Resolves YES if Safaricom reports M-Pesa 30-day active users above 35 million in any 2026 results release.",
        "closes": "2026-12-31", "resolves": "2027-01-31",
        "tags": ["mpesa","safaricom","fintech","kenya"],
        "cover": (C, "safaricom.co.ke"), "yes": 0.55,
    },
    {
        "slug": "ke-most-used-app-2026",
        "title": "Most-used app in Kenya, end of 2026?",
        "desc": "Which app leads Kenyan daily usage as 2026 closes?",
        "category": "technology", "rtype": "multiple_choice",
        "criteria": "Resolves to the app ranked #1 by monthly active users in Kenya per a reputable 2026 year-end analytics report.",
        "closes": "2026-12-31", "resolves": "2027-01-20",
        "tags": ["kenya","apps","tiktok","whatsapp"],
        "cover": (C, "whatsapp.com"), "trending": True,
        "options": [
            ("WhatsApp", C, "whatsapp.com", 0.40),
            ("TikTok", C, "tiktok.com", 0.30),
            ("Facebook", C, "facebook.com", 0.15),
            ("Instagram", C, "instagram.com", 0.09),
            ("X", C, "x.com", 0.06),
        ],
    },
    {
        "slug": "ke-starlink-100k-2026",
        "title": "Starlink tops 100k Kenya users in 2026?",
        "desc": "Starlink's fast Kenyan growth is reshaping the ISP market and pressuring incumbents.",
        "category": "technology", "rtype": "binary",
        "criteria": "Resolves YES if Starlink is reported (CA Kenya or company data) above 100,000 active Kenyan subscribers in 2026.",
        "closes": "2026-12-31", "resolves": "2027-01-31",
        "tags": ["starlink","internet","kenya","isp"],
        "cover": (C, "starlink.com"), "yes": 0.45,
    },
    {
        "slug": "ke-equity-profit-50b-2026",
        "title": "Equity Group profit above KES 50B in 2026?",
        "desc": "Equity is East Africa's largest bank by customers; its full-year profit is a bellwether.",
        "category": "business", "rtype": "binary",
        "criteria": "Resolves YES if Equity Group reports full-year 2026 profit after tax above KES 50 billion.",
        "closes": "2027-03-31", "resolves": "2027-04-15",
        "tags": ["equity","banking","earnings","kenya"],
        "cover": (C, "equitygroupholdings.com"), "yes": 0.52,
    },

    # ==================== SOCIAL / GOVERNANCE / HOUSING ====================
    {
        "slug": "ke-genz-protest-h2-2026",
        "title": "Nationwide Gen-Z protest in H2 2026?",
        "desc": "The Gen-Z movement that reshaped 2024 politics remains a live force against new taxes.",
        "category": "social", "rtype": "binary",
        "criteria": "Resolves YES if youth-led protests are reported in 5+ counties on the same cause between 1 Jul and 31 Dec 2026.",
        "closes": "2026-12-31", "resolves": "2027-01-05",
        "tags": ["kenya","genz","protests","youth"],
        "cover": (F, "ke"), "featured": True, "trending": True, "yes": 0.6,
    },
    {
        "slug": "ke-hashtag-number-one-2026",
        "title": "Kenyan political hashtag hits #1 on X in 2026?",
        "desc": "From #RejectFinanceBill to #RutoMustGo, Kenyan youth own the timeline.",
        "category": "social", "rtype": "binary",
        "criteria": "Resolves YES if a Kenyan political/protest hashtag reaches the #1 trending spot on X in Kenya during 2026 (evidence-backed).",
        "closes": "2026-12-31", "resolves": "2027-01-05",
        "tags": ["kenya","x","hashtag","genz"],
        "cover": (C, "x.com"), "yes": 0.78,
    },
    {
        "slug": "ke-housing-45k-units-2026",
        "title": "Govt completes 45,000 housing units in 2026?",
        "desc": "The Affordable Housing Programme targets 45,000 units by year-end amid levy controversy.",
        "category": "governance", "rtype": "binary",
        "criteria": "Resolves YES if the government reports 45,000 or more completed Affordable Housing units by 31 Dec 2026.",
        "closes": "2026-12-31", "resolves": "2027-01-31",
        "tags": ["kenya","housing","levy","boma-yangu"],
        "cover": (F, "ke"), "yes": 0.4,
    },
    {
        "slug": "ke-housing-levy-scrapped-2027",
        "title": "Housing Levy scrapped before 2027 vote?",
        "desc": "The 1.5% Affordable Housing Levy is among the most resented payslip deductions.",
        "category": "governance", "rtype": "binary",
        "criteria": "Resolves YES if the Affordable Housing Levy is repealed or suspended by law before 1 Aug 2027.",
        "closes": "2027-07-31", "resolves": "2027-08-02",
        "tags": ["kenya","housing","levy","tax"],
        "cover": (F, "ke"), "yes": 0.18,
    },

    # ==================== HEALTH / WEATHER ====================
    {
        "slug": "ke-sha-20m-2026",
        "title": "SHA covers 20M+ Kenyans by Dec 2026?",
        "desc": "The Social Health Authority replaced NHIF; enrolment numbers are politically charged.",
        "category": "health", "rtype": "binary",
        "criteria": "Resolves YES if the Social Health Authority reports 20 million or more registered members by 31 Dec 2026.",
        "closes": "2026-12-31", "resolves": "2027-01-20",
        "tags": ["kenya","sha","health","insurance"],
        "cover": (F, "ke"), "yes": 0.5,
    },
    {
        "slug": "ke-elnino-floods-2026",
        "title": "El Niño floods declared in Kenya in 2026?",
        "desc": "Kenya's short-rains season (Oct–Dec) can bring destructive flooding.",
        "category": "weather", "rtype": "binary",
        "criteria": "Resolves YES if the Kenya Met Department or government declares flood emergencies in 3+ counties in the 2026 short rains.",
        "closes": "2026-12-15", "resolves": "2027-01-05",
        "tags": ["kenya","weather","floods","elnino"],
        "cover": (F, "ke"), "yes": 0.45,
    },

    # ==================== RESOLVED (for Closed/Resolved surfaces) ====================
    {
        "slug": "ke-chan-2024-kenya-semifinal",
        "title": "Kenya reach the CHAN semifinal?",
        "desc": "Harambee Stars topped a tough CHAN group and met Madagascar in the quarterfinal.",
        "category": "sports", "rtype": "binary",
        "criteria": "Resolves YES if Kenya reached the CHAN 2024 semifinals.",
        "closes": "2025-08-24", "resolves": "2025-08-25",
        "tags": ["kenya","chan","football","2025"],
        "cover": (F, "ke"), "yes": 0.5, "resolve_to": "no",
    },
    {
        "slug": "ke-gachagua-impeached-2026",
        "title": "Gachagua impeachment upheld by High Court?",
        "desc": "The High Court ruled on the petitions challenging Gachagua's October 2024 removal.",
        "category": "politics", "rtype": "binary",
        "criteria": "Resolves YES if the High Court upheld Gachagua's impeachment.",
        "closes": "2026-06-08", "resolves": "2026-06-09",
        "tags": ["kenya","gachagua","court","2026"],
        "cover": (P, "Rigathi Gachagua"), "yes": 0.6, "resolve_to": "yes",
    },
]

# Company entities that resolve better from Wikipedia than favicon services.
COMPANY_WIKI = {
    "eabl.com": "East African Breweries",
    "equitygroupholdings.com": "Equity Group Holdings",
    "co-opbank.co.ke": "Co-operative Bank of Kenya",
    "kenya-airways.com": "Kenya Airways",
    "starlink.com": "Starlink",
}

# person label -> wikipedia page title override (when label != page title)
PERSON_WIKI = {
    "Sauti Sol": "Sauti Sol",
    "Akothee": "Akothee",
}

if __name__ == "__main__":
    n_bin = sum(1 for m in MARKETS if m["rtype"] == "binary")
    n_mc = sum(1 for m in MARKETS if m["rtype"] == "multiple_choice")
    n_opt = sum(len(m.get("options", [])) for m in MARKETS)
    cats = sorted({m["category"] for m in MARKETS})
    print(f"markets={len(MARKETS)} binary={n_bin} multi={n_mc} options={n_opt}")
    print("categories:", cats)
