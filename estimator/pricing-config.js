/*
 * TITAN ROOFING — INSTANT ESTIMATE PRICING
 * ---------------------------------------------------------------
 * The ONLY file to edit to change what the estimator quotes.
 *
 * Positioning: "fair for Titan" — modestly below typical Houston pricing,
 * justified by real cost advantages (long-tenured crews, 25-year supplier
 * relationships, established overhead). Not a race to the bottom.
 *
 * !! BEFORE LAUNCH: check Titan's actual completed-job price per square
 * !! against the ranges below, then set `pricesConfirmed: true` (this
 * !! removes the "Draft pricing" banner and the DRAFT tag on leads).
 *
 * How the estimate is built (all prices per roofing square, 1 SQ = 100 sq ft
 * of roof surface, labor + materials, full tear-off):
 *   mult  = stories x complexity x pitch
 *   low   = tier.low  x mult x squares   (rounded to $50)
 *   high  = tier.high x mult x squares   (rounded to $50)
 *   Houston typical = market.low/high x mult x squares (rounded to $100)
 */
window.TITAN_PRICING = {
  pricesConfirmed: false,
  lastReviewed: "2026-11-01 (pending Titan sign-off)",

  // Smallest full reroof Titan will quote.
  minimumJob: 6500,

  // Shingle tiers. low/high = Titan's installed price per square.
  // market = typical fair Houston price per square (web research, not Titan data).
  materials: {
    "3tab": {
      name: "3-Tab Asphalt Shingle",
      short: "3-Tab",
      badge: "Budget",
      blurb: "Flat, single-layer shingle. Lowest upfront cost. Best for rentals and flips.",
      low: 400, high: 480,
      market: [420, 490],
      specs: ["Lowest upfront cost", "Single-layer construction", "Shorter service life than architectural"],
      swatch: { base: "#5A5F66", light: "#6E737A", dark: "#3E4248", flat: true }
    },
    arch: {
      name: "Architectural Shingle (CertainTeed Landmark)",
      short: "Architectural",
      badge: "Most popular",
      blurb: "30-year laminated shingle with dimensional look. The system on most Titan roofs.",
      low: 450, high: 580,
      market: [525, 625],
      specs: ["Laminated, two-layer construction", "StreakFighter algae resistance", "SureStart PLUS warranty upgrade available"],
      swatch: { base: "#4A4F57", light: "#6B717A", dark: "#2E3238" }
    },
    ir: {
      name: "Class 4 Impact-Resistant Shingle",
      short: "Class 4 IR",
      badge: "Best for hail",
      blurb: "Highest hail rating available for shingles. Many Texas insurers discount premiums for Class 4 roofs; ask your agent.",
      low: 560, high: 720,
      market: [650, 775],
      specs: ["Class 4 impact rating (UL 2218)", "Built for hail country", "Possible insurance discount"],
      swatch: { base: "#3D4652", light: "#5A6576", dark: "#262C35" }
    }
  },
  defaultMaterial: "arch",

  // Multipliers (stack multiplicatively).
  stories: { "1": 1.00, "2": 1.08, "3": 1.16 },
  complexity: {
    simple:   { label: "Simple",   desc: "Mostly gable, long unbroken roof planes", factor: 0.95 },
    standard: { label: "Standard", desc: "Some valleys and hips. Most Houston homes", factor: 1.00 },
    complex:  { label: "Complex",  desc: "Many cuts, dormers, intersecting rooflines", factor: 1.10 }
  },
  // Pitch. `factor` = price multiplier (steeper = slower, more safety setup).
  // `areaFactor` = home footprint -> roof surface, incl. overhangs (manual mode only).
  // `maxRise` = upper bound used to classify a satellite-measured pitch.
  pitch: {
    low:      { label: "Low",        range: "under 5/12", note: "Easy to walk",       maxRise: 4.5,  factor: 1.00, areaFactor: 1.15 },
    standard: { label: "Standard",   range: "5–7/12",     note: "Most Houston homes", maxRise: 7.5,  factor: 1.05, areaFactor: 1.22 },
    steep:    { label: "Steep",      range: "8–10/12",    note: "Needs safety gear",  maxRise: 10.5, factor: 1.18, areaFactor: 1.32 },
    vsteep:   { label: "Very steep", range: "over 10/12", note: "Hard to stand on",   maxRise: 99,   factor: 1.25, areaFactor: 1.42 }
  },

  // Manual mode: living area -> footprint. 2-story homes rarely have a full
  // second floor, so footprint = living area / 1.65 rather than / 2.
  storyDivisor: { "1": 1, "2": 1.65, "3": 2.3 },
  garageFootprint: 440,

  // Included in every Titan reroof (shown on the results page).
  scope: [
    ["Complete tear-off to bare decking", "Included"],
    ["Synthetic underlayment, full coverage", "Included"],
    ["Ice & water shield in all valleys", "Included"],
    ["Drip edge, eaves and rakes", "Included"],
    ["Continuous ridge vent", "Included"],
    ["Starter strip course", "Included"],
    ["New pipe boots on every penetration", "Included"],
    ["Step flashing at walls", "Included"],
    ["Decking replacement", "Up to 5 sheets, then $85/sheet"],
    ["Debris haul-off and magnetic nail sweep", "Included"],
    ["Titan workmanship warranty", "Included"],
    ["CertainTeed manufacturer warranty", "Per product"]
  ],

  // Things that can move the final price after inspection.
  adjustments: [
    "A second layer of old shingles: about $32/SQ more (typically $900–$1,200). Most Houston homes have one layer; we confirm before any work starts.",
    "Decking beyond the 5 included sheets: $85 per sheet, shown to you first.",
    "Chimney, skylight or wall flashing rebuilds.",
    "Ventilation upgrades. Gutters are not included."
  ],

  // What it typically costs to add an item another quote leaves out.
  // Used for the apples-to-apples comparison. perSquare = $/SQ, flat = $/job.
  competitorGaps: {
    tearoff: {
      label: "Full tear-off to bare decking",
      ifMissing: "Laying new shingles over old ones hides rotten decking, adds weight and voids most manufacturer warranties.",
      ask: "Will you tear off every existing layer down to the decking?",
      perSquare: 65
    },
    underlayment: {
      label: "Synthetic underlayment",
      ifMissing: "Felt paper absorbs water and typically fails years before the shingles do.",
      ask: "Is the new underlayment synthetic or felt?",
      perSquare: 20
    },
    valleys: {
      label: "Ice & water shield in valleys",
      ifMissing: "Valleys are a top leak spot. Texas code doesn't require it, so many quotes skip it.",
      ask: "Do you install ice & water shield in every valley?",
      flat: 350
    },
    boots: {
      label: "New pipe boots & flashing",
      ifMissing: "Reused boots crack in the sun and cause slow, hidden leaks.",
      ask: "Are all pipe boots and flashing replaced, or reused if they 'look okay'?",
      flat: 400
    },
    certified: {
      label: "Manufacturer-certified installer",
      ifMissing: "Without certification, extended system warranties like CertainTeed SureStart PLUS aren't available at any price.",
      ask: "Are you certified by the shingle manufacturer, and which warranty will I actually get?",
      flat: 0
    }
  },

  contact: {
    name: "Colin",
    phoneDisplay: "(936) 827-1550",
    phoneTel: "+19368271550",
    email: "info@titanroofingtx.com"
  }
};
