#!/usr/bin/env python3
"""
Generate the synthetic dataset for the Customer Success demo dashboard.

Everything here is invented. No real customer, company, or employee data is
used or derived from any live system. Re-running with the same SEED reproduces
the identical dataset, so the committed assets/data.js is reviewable.

The script emits only *base facts* (accounts, survey responses, quarterly
goals). Every headline metric - NRR, GRR, churn, NPS - is derived from those
facts at render time in app.js, so no roll-up can disagree with its parts.
"""
import json
import random
from datetime import date, timedelta

SEED = 20260923
AS_OF = date(2026, 9, 23)

random.seed(SEED)

# --- invented account managers -------------------------------------------
AMS = [
    "Avery Lindqvist",
    "Dane Okonjo",
    "Sable Ferraro",
    "Rowan Whitfield",
    "Ines Delacroix",
    "Marek Yolen",
]

SEGMENTS = ["Enterprise", "Mid Market", "Scale Up", "Startup"]
ARR_BANDS = {
    "Enterprise": (260_000, 880_000),
    "Mid Market": (85_000, 250_000),
    "Scale Up": (32_000, 80_000),
    "Startup": (9_000, 30_000),
}

INDUSTRIES = [
    "Technology",
    "Healthcare",
    "Financial Services",
    "Manufacturing",
    "Logistics",
    "Retail & CPG",
]

# --- invented customer names ---------------------------------------------
COMPANIES = [
    "Northwind Analytics", "Velocity Freight", "Cobalt Health", "Tidemark Legal",
    "Quarry Robotics", "Lumen Retail", "Ferrous Steelworks", "Pinegrove Financial",
    "Harbor Point Insurance", "Sundial Media", "Axiom Biotech", "Drayton Logistics",
    "Kestrel Energy", "Mosaic Education", "Ravine Outdoor", "Solstice Travel",
    "Ironvale Manufacturing", "Brightloom Apparel", "Candor HR", "Meridian Telecom",
    "Alder Grove Foods", "Peakline Construction", "Vantage Payments", "Wexler Pharma",
    "Glasshouse Design", "Thornbury Agritech", "Onyx Security", "Calder Marine",
    "Fernwood Hospitality", "Stagecoach Rail", "Bluepeak Mining", "Lyre Music",
    "Summit Dental", "Halyard Shipping", "Juniper Labs", "Windrow Farms",
    "Copperline Utilities", "Dovetail Furniture", "Estuary Water", "Fairbank Credit",
    "Greylock Aero", "Hollis Textiles", "Inkwell Publishing", "Jetstream HVAC",
    "Kiln Ceramics", "Larkspur Wellness", "Marlin Sportswear", "Nettle Organics",
]

HEALTH = ["Healthy", "Watch", "At Risk"]


def quarter_of(d):
    return f"{d.year}-Q{(d.month - 1) // 3 + 1}"


def round_to(n, step):
    return int(round(n / step) * step)


# -------------------------------------------------------------------------
# Accounts. arr_start is ARR at the start of the trailing 12 months; the
# movement fields are what happened to it since.
# -------------------------------------------------------------------------
accounts = []
# Deliberately shape the book: a few churns and contractions against broad
# modest expansion, so the derived NRR/GRR land in a believable range.
churn_idx = {6, 19, 31, 44}          # 4 logos lost
contract_idx = {2, 11, 23, 28, 37, 41}  # 6 downsells

for i, name in enumerate(COMPANIES):
    segment = SEGMENTS[i % 4]
    lo, hi = ARR_BANDS[segment]
    arr_start = round_to(random.uniform(lo, hi), 1_000)
    am = AMS[i % len(AMS)]
    industry = INDUSTRIES[(i * 5 + i // 6) % len(INDUSTRIES)]

    expansion = 0
    contraction = 0
    churned_arr = 0
    status = "active"

    if i in churn_idx:
        status = "churned"
        churned_arr = arr_start
    elif i in contract_idx:
        contraction = round_to(arr_start * random.uniform(0.12, 0.34), 500)
    else:
        # ~85% of retained accounts expanded
        if random.random() < 0.85:
            expansion = round_to(arr_start * random.uniform(0.08, 0.45), 500)

    arr_now = 0 if status == "churned" else arr_start + expansion - contraction

    if status == "churned":
        renewal = None
        days_to_renewal = None
        health = "Churned"
    else:
        days_to_renewal = random.randint(6, 348)
        renewal = (AS_OF + timedelta(days=days_to_renewal)).isoformat()
        # health correlates with movement, with some noise
        if contraction > 0:
            health = random.choices(HEALTH, weights=[5, 30, 65])[0]
        elif expansion > 0:
            health = random.choices(HEALTH, weights=[74, 22, 4])[0]
        else:
            health = random.choices(HEALTH, weights=[42, 45, 13])[0]

    accounts.append({
        "id": f"ACC-{1000 + i}",
        "name": name,
        "segment": segment,
        "industry": industry,
        "am": am,
        "arrStart": arr_start,
        "arrNow": arr_now,
        "expansion": expansion,
        "contraction": contraction,
        "churnedArr": churned_arr,
        "status": status,
        "renewalDate": renewal,
        "daysToRenewal": days_to_renewal,
        "health": health,
    })

# -------------------------------------------------------------------------
# NPS survey responses. Each response points at an account, so the breakdowns
# by segment / industry / account manager are derived, never separately stated.
# -------------------------------------------------------------------------
PROMOTER_NOTES = [
    "Onboarding was the smoothest vendor rollout we have run. Support replies same day.",
    "The quarterly business review actually changed our roadmap. Genuinely useful.",
    "Our account manager flagged a problem before we noticed it. That builds trust.",
    "Reporting saves my team about a day a week. Easy recommendation.",
    "Renewal was painless and the pricing conversation was straight with us.",
    "We have rolled this out to two more departments on the strength of the first one.",
]
PASSIVE_NOTES = [
    "Does what we need. Nothing has gone wrong, nothing has wowed us either.",
    "Good product, but the admin permissions model is more work than it should be.",
    "Happy overall. Would like a clearer picture of what is shipping next quarter.",
    "Solid, though we still export to a spreadsheet for our board reporting.",
    "Support is responsive. The docs could be a lot better.",
]
DETRACTOR_NOTES = [
    "Three support tickets open past their stated SLA. That is the whole of my score.",
    "We were moved to a new account manager twice in six months with no handover.",
    "The last release broke a workflow we depend on and it took a week to sort.",
    "Price went up and I cannot point to what we got for it.",
    "Integration is still not live four months after kickoff.",
]
FIRST_NAMES = [
    "Nadia", "Emeka", "Lowell", "Bettina", "Farid", "Corinne", "Yusuf", "Margit",
    "Desmond", "Anouk", "Tarek", "Sloane", "Piotr", "Imani", "Gregor", "Delphine",
    "Kwame", "Astrid", "Rafael", "Noor", "Hollis", "Sigrid", "Milo", "Fenna",
]
LAST_NAMES = [
    "Achebe", "Brandt", "Castellanos", "Duong", "Eskildsen", "Farouk", "Gallardo",
    "Hjalmarsson", "Ibarra", "Jastrzebski", "Kowalczyk", "Lindgren", "Moreau",
    "Nkemelu", "Ostrowski", "Pettersson", "Quintero", "Rasmussen", "Sorrentino",
    "Thorvaldsen", "Ueda", "Vasquez", "Wierzbicki", "Zielinski",
]
TITLES = [
    "VP Operations", "Head of IT", "Director of Finance", "COO", "Head of People",
    "Director of Engineering", "VP Customer Experience", "Head of Data",
    "Procurement Lead", "Director of Marketing",
]

# Survey dates spread across 2026 up to today, weighted toward recent quarters.
active_accounts = [a for a in accounts if a["status"] == "active"]
churned_accounts = [a for a in accounts if a["status"] == "churned"]

responses = []
rid = 0


def add_response(acct, day, score_pool):
    global rid
    rid += 1
    score = random.choice(score_pool)
    if score >= 9:
        note = random.choice(PROMOTER_NOTES)
    elif score >= 7:
        note = random.choice(PASSIVE_NOTES)
    else:
        note = random.choice(DETRACTOR_NOTES)
    responses.append({
        "id": f"NPS-{2000 + rid}",
        "accountId": acct["id"],
        "company": acct["name"],
        "segment": acct["segment"],
        "industry": acct["industry"],
        "am": acct["am"],
        "respondent": f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}",
        "title": random.choice(TITLES),
        "score": score,
        "date": day.isoformat(),
        "quarter": quarter_of(day),
        "comment": note,
    })


# Score pools tuned per health so the NPS breakdowns are coherent with the book.
POOLS = {
    "Healthy": [9, 9, 9, 10, 10, 8, 10, 9],
    "Watch": [7, 8, 7, 9, 6, 8, 7],
    "At Risk": [4, 5, 3, 6, 2, 5, 6],
    "Churned": [2, 3, 1, 4, 3],
}

QUARTER_WINDOWS = [
    ("2026-Q1", date(2026, 1, 8), date(2026, 3, 28), 24),
    ("2026-Q2", date(2026, 4, 6), date(2026, 6, 27), 27),
    ("2026-Q3", date(2026, 7, 6), date(2026, 9, 20), 30),
]

# A stable survey panel, re-surveyed each quarter, rather than a fresh random
# cohort every time. Resampling the whole book each quarter made quarter-over-
# quarter NPS swing on sampling noise alone (68 -> 35 -> 48 in an earlier run),
# which reads as broken rather than as a trend.
panel = random.sample(accounts, 34)

# Deliberate, gentle drift so the quarterly trend is coherent: sentiment
# improving off a weak Q1. Applied as a nudge to the drawn score, so the
# response still belongs to its account and every breakdown stays derived.
QUARTER_DRIFT = {"2026-Q1": -1, "2026-Q2": 0, "2026-Q3": +1}
DRIFT_ODDS = 0.25

for qname, start, end, n in QUARTER_WINDOWS:
    span = (end - start).days
    # A churned logo can only answer a survey sent while it was still a customer.
    eligible = [a for a in panel if a["status"] == "active" or qname != "2026-Q3"]
    for acct in random.sample(eligible, min(n, len(eligible))):
        day = start + timedelta(days=random.randint(0, span))
        pool = POOLS[acct["health"]]
        score = random.choice(pool)
        drift = QUARTER_DRIFT[qname]
        if drift and random.random() < DRIFT_ODDS:
            score = max(0, min(10, score + drift))
        add_response(acct, day, [score])

responses.sort(key=lambda r: r["date"], reverse=True)

# -------------------------------------------------------------------------
# Quarterly goals + weekly actuals for the team tab.
# 14 week buckets covering 2026-Q3; weeks after AS_OF are null so the line
# stops at "today" rather than implying data we do not have.
# -------------------------------------------------------------------------
Q_START = date(2026, 7, 1)
WEEKS = 14
weeks_elapsed = min(WEEKS, (AS_OF - Q_START).days // 7 + 1)

# NRR here is the SAME derived measure the KPIs tab shows (trailing 12 months,
# from the account movement fields) - not an independently invented number.
# An earlier version rolled its own quarterly NRR per AM, which disagreed with
# the KPI roll-up for the same person (88.8% vs 97.7%) and read as a bug.
def am_nrr(am):
    book = [a for a in accounts if a["am"] == am]
    st = sum(a["arrStart"] for a in book)
    e = sum(a["expansion"] for a in book)
    c = sum(a["contraction"] for a in book)
    ch = sum(a["churnedArr"] for a in book)
    return round(100 * (st + e - c - ch) / st, 1)


goals = []
for idx, am in enumerate(AMS):
    book = [a for a in accounts if a["am"] == am]
    book_start = sum(a["arrStart"] for a in book)

    nrr_goal = [108.0, 112.0, 105.0, 110.0, 106.0, 114.0][idx]
    nrr_landing = am_nrr(am)
    upsell_goal = round_to(book_start * random.uniform(0.055, 0.085), 1_000)

    # Where they land on upsell for the quarter to date, as a fraction of goal.
    attainment = [0.94, 1.07, 0.71, 0.88, 1.02, 0.63][idx]
    upsell_actual = round_to(upsell_goal * attainment * (weeks_elapsed / WEEKS), 500)

    # Weekly cumulative upsell: monotonically rising, lumpy, landing on actual.
    raw = sorted(random.uniform(0.04, 1.0) for _ in range(weeks_elapsed - 1))
    upsell_series = []
    for w in range(WEEKS):
        if w < weeks_elapsed - 1:
            upsell_series.append(round_to(upsell_actual * raw[w], 500))
        elif w == weeks_elapsed - 1:
            upsell_series.append(upsell_actual)
        else:
            upsell_series.append(None)

    # Weekly NRR: starts somewhere plausible and drifts to the derived figure.
    # Some AMs improve across the quarter, some slide.
    nrr_start_val = nrr_landing - random.uniform(-4.0, 6.0)
    nrr_series = []
    for w in range(weeks_elapsed):
        t = w / max(1, weeks_elapsed - 1)
        val = nrr_start_val + (nrr_landing - nrr_start_val) * t + random.uniform(-0.9, 0.9)
        nrr_series.append(round(val, 1))
    nrr_series[0] = round(nrr_start_val, 1)
    nrr_series[weeks_elapsed - 1] = nrr_landing
    nrr_series += [None] * (WEEKS - weeks_elapsed)

    goals.append({
        "am": am,
        "nrrGoal": nrr_goal,
        "nrrActual": nrr_landing,
        "upsellGoal": upsell_goal,
        "upsellActual": upsell_actual,
        "upsellSeries": upsell_series,
        "nrrSeries": nrr_series,
    })

# -------------------------------------------------------------------------
# Quarterly book-level trend, for the stat-tile deltas and sparklines.
# The FINAL point of each series is the value derived from the accounts above,
# so the tile's headline number and its sparkline endpoint cannot disagree.
# -------------------------------------------------------------------------
_bs = sum(a["arrStart"] for a in accounts)
_be = sum(a["expansion"] for a in accounts)
_bc = sum(a["contraction"] for a in accounts)
_bch = sum(a["churnedArr"] for a in accounts)
CUR_NRR = round(100 * (_bs + _be - _bc - _bch) / _bs, 1)
CUR_GRR = round(100 * (_bs - _bc - _bch) / _bs, 1)
CUR_CHURN = round(100 * _bch / _bs, 1)

TREND_QUARTERS = ["2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2", "2026-Q3"]
# Offsets applied to the current value for the five preceding quarters; the last
# entry is 0 so the series ends exactly on the derived figure.
_nrr_off = [-7.4, -5.1, -5.8, -3.2, -1.5, 0.0]
_grr_off = [-3.9, -2.6, -3.1, -1.4, -0.7, 0.0]
_chn_off = [+2.8, +1.9, +2.2, +1.1, +0.5, 0.0]

book_trend = [
    {
        "quarter": q,
        "nrr": round(CUR_NRR + _nrr_off[i], 1),
        "grr": round(CUR_GRR + _grr_off[i], 1),
        "revChurn": round(CUR_CHURN + _chn_off[i], 1),
    }
    for i, q in enumerate(TREND_QUARTERS)
]

week_labels = [(Q_START + timedelta(days=7 * w)).strftime("%b %-d") for w in range(WEEKS)]

payload = {
    "meta": {
        "generatedFor": "Customer Success demo dashboard",
        "synthetic": True,
        "note": "All accounts, people and scores in this file are invented for demo use.",
        "seed": SEED,
        "asOf": AS_OF.isoformat(),
        "quarter": quarter_of(AS_OF),
        "priorQuarter": "2026-Q2",
        "year": AS_OF.year,
        "weeksElapsed": weeks_elapsed,
        "weekLabels": week_labels,
    },
    "ams": AMS,
    "segments": SEGMENTS,
    "industries": INDUSTRIES,
    "healthStates": HEALTH,
    "accounts": accounts,
    "npsResponses": responses,
    "goals": goals,
    "bookTrend": book_trend,
}

out = "/home/user/presentationtest/assets/data.js"
with open(out, "w") as f:
    f.write("/* GENERATED FILE - edit tools/generate_data.py and re-run instead.\n")
    f.write("   100% synthetic demo data. No real customer or employee information. */\n")
    f.write("window.CS_DATA = ")
    json.dump(payload, f, indent=2)
    f.write(";\n")

# --- sanity report so the numbers are checked, not assumed -----------------
start = sum(a["arrStart"] for a in accounts)
exp = sum(a["expansion"] for a in accounts)
con = sum(a["contraction"] for a in accounts)
chn = sum(a["churnedArr"] for a in accounts)
print(f"accounts={len(accounts)} active={len(active_accounts)} churned={len(churned_accounts)}")
print(f"ARR start=${start:,} now=${sum(a['arrNow'] for a in accounts):,}")
print(f"NRR={100*(start+exp-con-chn)/start:.1f}%  GRR={100*(start-con-chn)/start:.1f}%  "
      f"revChurn={100*chn/start:.1f}%  logoChurn={100*len(churned_accounts)/len(accounts):.1f}%")
for q in ["2026-Q1", "2026-Q2", "2026-Q3"]:
    rs = [r for r in responses if r["quarter"] == q]
    p = sum(1 for r in rs if r["score"] >= 9)
    d = sum(1 for r in rs if r["score"] <= 6)
    print(f"{q}: n={len(rs)} NPS={round(100*(p-d)/len(rs))}")
allr = responses
p = sum(1 for r in allr if r["score"] >= 9)
d = sum(1 for r in allr if r["score"] <= 6)
print(f"YTD: n={len(allr)} NPS={round(100*(p-d)/len(allr))}")
print(f"weeksElapsed={weeks_elapsed}")
