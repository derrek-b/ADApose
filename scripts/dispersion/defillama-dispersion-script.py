#!/usr/bin/env python3
"""
ADApose — Cardano DEX fee-APR dispersion snapshot.

Pulls per-pool base APY (fee yield, excluding reward emissions) for every
Cardano pool DefiLlama tracks, across all DEXs, plus up to 90 days of history
per pool. Computes cross-sectional dispersion and rank persistence.

No API key. No account. Read-only. Takes a few minutes (rate-limited).

    python3 dispersion_snapshot.py

Outputs into ./adapose_dispersion/ :
    pools_snapshot.csv    one row per Cardano pool, current state
    pool_history.csv      long format: pool_id, date, tvlUsd, apyBase
    summary.txt           the numbers that answer the question
    raw_pools.json        unmodified API response for the Cardano subset

Send me the whole adapose_dispersion folder.

CAVEAT, read this: DefiLlama's Cardano adapters have known defects — a
SundaeSwap volume bug (commit 548cd1db, 2026-05-20) and a Splash unit
double-conversion. Treat SundaeSwap numbers as unreliable and Splash levels
as suspect. Minswap and WingRiders are the load-bearing venues here. This is
a fast first read, NOT the gold-standard measurement; that one reads k
directly off-chain.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from collections import defaultdict

OUT = "adapose_dispersion"
TVL_FLOOR = 25_000          # USD; below this the APR is noise and we can't deploy into it anyway
HISTORY_MAX_POOLS = 400     # cap on how many pools we pull history for
SLEEP = 0.25                # be polite to the API


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "adapose-research/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            if i == tries - 1:
                print(f"    ! failed {url}: {e}", file=sys.stderr)
                return None
            time.sleep(2 * (i + 1))


def pct(vals, p):
    if not vals:
        return float("nan")
    s = sorted(vals)
    k = (len(s) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def spearman(pairs):
    """Rank correlation. pairs = [(x, y), ...]"""
    n = len(pairs)
    if n < 5:
        return float("nan")

    def ranks(vals):
        order = sorted(range(n), key=lambda i: vals[i])
        r = [0.0] * n
        i = 0
        while i < n:
            j = i
            while j + 1 < n and vals[order[j + 1]] == vals[order[i]]:
                j += 1
            avg = (i + j) / 2 + 1
            for k in range(i, j + 1):
                r[order[k]] = avg
            i = j + 1
        return r

    rx, ry = ranks([p[0] for p in pairs]), ranks([p[1] for p in pairs])
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((rx[i] - mx) * (ry[i] - my) for i in range(n))
    dx = sum((rx[i] - mx) ** 2 for i in range(n)) ** 0.5
    dy = sum((ry[i] - my) ** 2 for i in range(n)) ** 0.5
    return num / (dx * dy) if dx and dy else float("nan")


def main():
    os.makedirs(OUT, exist_ok=True)

    print("[1/3] fetching all pools ...")
    blob = get("https://yields.llama.fi/pools")
    if not blob or "data" not in blob:
        sys.exit("could not fetch pool list — check connectivity and retry")

    cardano = [p for p in blob["data"] if (p.get("chain") or "").lower() == "cardano"]
    print(f"      {len(cardano)} Cardano pools")
    with open(f"{OUT}/raw_pools.json", "w") as f:
        json.dump(cardano, f, indent=1)

    cols = ["pool", "project", "symbol", "tvlUsd", "apyBase", "apyReward", "apy",
            "apyBase7d", "apyMean30d", "volumeUsd1d", "volumeUsd7d", "ilRisk",
            "exposure", "stablecoin", "poolMeta"]
    with open(f"{OUT}/pools_snapshot.csv", "w") as f:
        f.write(",".join(cols) + "\n")
        for p in cardano:
            row = []
            for c in cols:
                v = p.get(c)
                v = "" if v is None else str(v).replace(",", ";").replace("\n", " ")
                row.append(v)
            f.write(",".join(row) + "\n")

    # ---- history -------------------------------------------------------
    elig = [p for p in cardano if (p.get("tvlUsd") or 0) >= TVL_FLOOR]
    elig.sort(key=lambda p: -(p.get("tvlUsd") or 0))
    elig = elig[:HISTORY_MAX_POOLS]
    print(f"[2/3] fetching history for {len(elig)} pools above ${TVL_FLOOR:,} TVL ...")

    hist = {}
    with open(f"{OUT}/pool_history.csv", "w") as f:
        f.write("pool,project,symbol,date,tvlUsd,apyBase\n")
        for i, p in enumerate(elig, 1):
            if i % 25 == 0:
                print(f"      {i}/{len(elig)}")
            ch = get(f"https://yields.llama.fi/chart/{p['pool']}")
            time.sleep(SLEEP)
            if not ch or not ch.get("data"):
                continue
            series = []
            for pt in ch["data"]:
                ab = pt.get("apyBase")
                if ab is None:
                    continue
                d = (pt.get("timestamp") or "")[:10]
                series.append((d, pt.get("tvlUsd"), ab))
                f.write(f"{p['pool']},{p['project']},{p['symbol']},{d},{pt.get('tvlUsd')},{ab}\n")
            if series:
                hist[p["pool"]] = series

    # ---- analysis ------------------------------------------------------
    print("[3/3] computing dispersion and persistence ...")
    lines = []
    W = lines.append

    W("ADApose — Cardano DEX fee-APR dispersion snapshot")
    W("=" * 66)
    W(f"generated: {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}")
    W(f"source:    DefiLlama yields API (apyBase = fee yield, excludes rewards)")
    W(f"TVL floor: ${TVL_FLOOR:,}")
    W("")

    live = [p for p in cardano if (p.get("tvlUsd") or 0) >= TVL_FLOOR
            and p.get("apyBase") is not None]
    W(f"pools above floor with a base APY: {len(live)}")
    tot = sum(p["tvlUsd"] for p in live)
    W(f"combined TVL: ${tot:,.0f}")
    W("")

    W("--- CROSS-SECTIONAL DISPERSION, SWEPT ACROSS TVL FLOORS ---")
    W("  The floor matters: tiny pools print absurd APRs on one trade, so a low")
    W("  floor measures noise. A high floor measures pools we could actually")
    W("  enter. Read the trend, not any single row.")
    W("")
    W(f"  {'floor':>10}{'n':>6}{'TVL':>14}{'wtd(passive)':>14}{'median':>10}"
      f"{'75th':>10}{'90th':>10}{'wtd->75th':>12}")
    for floor in (0, 10_000, 25_000, 100_000, 250_000, 1_000_000):
        ps = [p for p in cardano if (p.get("tvlUsd") or 0) >= floor
              and p.get("apyBase") is not None]
        if not ps:
            W(f"  {floor:>10,}{0:>6}{'-':>14}")
            continue
        t = sum(p["tvlUsd"] for p in ps)
        w = sum(p["apyBase"] * p["tvlUsd"] for p in ps) / t if t else 0
        aa = [p["apyBase"] for p in ps]
        W(f"  {floor:>10,}{len(ps):>6}{t:>14,.0f}{w:>13.2f}%{pct(aa,.5):>9.2f}%"
          f"{pct(aa,.75):>9.2f}%{pct(aa,.9):>9.2f}%{pct(aa,.75)-w:>11.2f}pt")
    W("")
    W("  wtd(passive) = TVL-weighted mean = what a passive LP dollar earns.")
    W("  wtd->75th    = the spread we are trying to capture. THIS is the number.")
    W("")

    W("--- CAPACITY: CAN WE ACTUALLY FIT? ---")
    W("  Our own deposit dilutes the yield we came for:")
    W("      APR earned = headline APR x T / (T + D)")
    W("  To keep >=90% of headline we must be <=11% of the pool, i.e. T >= 9D.")
    W("  Assumes 3 concurrent positions.")
    W("")
    W(f"  {'AUM':>12}{'per position':>15}{'min pool size':>16}{'pools that fit':>16}{'their TVL':>14}")
    for aum in (250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000):
        d = aum / 3
        need = 9 * d
        fit = [p for p in cardano if (p.get("tvlUsd") or 0) >= need]
        W(f"  {aum:>12,}{d:>15,.0f}{need:>16,.0f}{len(fit):>16}"
          f"{sum(p['tvlUsd'] for p in fit):>14,.0f}")
    W("")
    W("  If 'pools that fit' goes to zero before target AUM, capacity binds")
    W("  before revenue does, and that is the real ceiling on the business.")
    W("")
    W("  Dispersion among pools that fit (the only dispersion we can capture):")
    for aum in (500_000, 1_000_000, 2_500_000):
        need = 9 * (aum / 3)
        ps = [p for p in cardano if (p.get("tvlUsd") or 0) >= need
              and p.get("apyBase") is not None]
        if len(ps) < 2:
            W(f"    AUM ${aum:>10,}: only {len(ps)} pool(s) qualify — no allocation possible")
            continue
        t = sum(p["tvlUsd"] for p in ps)
        w = sum(p["apyBase"] * p["tvlUsd"] for p in ps) / t
        aa = [p["apyBase"] for p in ps]
        W(f"    AUM ${aum:>10,}: {len(ps):>3} pools, passive {w:6.2f}%, "
          f"75th {pct(aa,.75):6.2f}%, capturable spread {pct(aa,.75)-w:5.2f}pt")

    W("")
    W("--- BY VENUE ---")
    byproj = defaultdict(list)
    for p in live:
        byproj[p["project"]].append(p)
    W(f"  {'venue':<28}{'n':>4}{'TVL':>14}{'wtd apyBase':>14}{'median':>10}{'90th':>10}")
    for proj, ps in sorted(byproj.items(), key=lambda kv: -sum(x["tvlUsd"] for x in kv[1])):
        t = sum(x["tvlUsd"] for x in ps)
        w = sum(x["apyBase"] * x["tvlUsd"] for x in ps) / t if t else 0
        aa = [x["apyBase"] for x in ps]
        W(f"  {proj:<28}{len(ps):>4}{t:>14,.0f}{w:>13.2f}%{pct(aa,.5):>9.2f}%{pct(aa,.9):>9.2f}%")

    W("")
    W("--- PERSISTENCE (does last month's leaderboard predict this month's?) ---")
    W("  Spearman rank correlation of apyBase, period n vs period n+1.")
    W("  This is THE number. High = the spread is capturable ex ante.")
    W("  Rough reading: >0.5 strong, 0.3-0.5 workable, <0.2 the thesis is wrong.")
    W("")
    for lag in (7, 14, 30, 60):
        pairs = []
        for pool, s in hist.items():
            s = sorted(s)
            if len(s) < lag + 2:
                continue
            then, now = s[-(lag + 1)][2], s[-1][2]
            if then is not None and now is not None:
                pairs.append((then, now))
        r = spearman(pairs)
        W(f"  {lag:>3}-day lag : rho = {r:6.3f}   (n = {len(pairs)} pools)")

    W("")
    W("--- HOW MUCH DOES A MOVE HAVE TO EARN ---")
    W("  Round-trip cost ~0.42% + ~7 ADA fixed.")
    W("  Payback days = 0.42 / (APR gain / 365 * 100) * 100")
    for gain in (2, 5, 10, 20):
        W(f"  +{gain:>2} point APR improvement pays back the round trip in "
          f"{0.42/(gain/365):>5.0f} days")

    W("")
    W("--- CAVEATS ---")
    W("  * SundaeSwap volume/fee figures are affected by a known DefiLlama")
    W("    adapter bug (commit 548cd1db, 2026-05-20). Discount them.")
    W("  * Splash levels are affected by a unit double-conversion (~6x).")
    W("    The RATE is unaffected; the LEVEL is not trustworthy.")
    W("  * apyBase here is DefiLlama-derived, not read from k on-chain.")
    W("    The authoritative measurement is sqrt(k) growth per pool.")
    W("  * Splash runs non-constant-product pool families (BalanceFnPool,")
    W("    StableFnPool, DegenQuadraticPool) that sqrt(k) does not apply to.")
    W("    Those are NOT filtered out here.")

    txt = "\n".join(lines)
    with open(f"{OUT}/summary.txt", "w") as f:
        f.write(txt + "\n")
    print("\n" + txt)
    print(f"\nWrote {OUT}/ — send me the whole folder.")


if __name__ == "__main__":
    main()
