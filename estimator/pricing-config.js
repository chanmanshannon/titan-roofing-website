/*
 * TITAN ROOFING — ESTIMATOR PRICING
 * ---------------------------------------------------------------
 * This is the ONLY file you need to edit to change what the online
 * estimator quotes. Everything here is plain numbers and text.
 *
 * !! BEFORE LAUNCH: every price below is a PLACEHOLDER based on
 * !! published Houston-area ranges (late 2026). Titan must replace
 * !! them with real installed prices. Set `pricesConfirmed: true`
 * !! once that is done (this hides the "draft pricing" banner).
 *
 * How the estimate is built:
 *   roof squares  (1 square = 100 sq ft of roof surface)
 *   x price per square for the chosen material (low / high)
 *   x pitch factor x complexity factor x stories factor
 *   then widened by the measurement uncertainty, rounded to $100,
 *   and never below the minimum job price.
 */
window.TITAN_PRICING = {
  pricesConfirmed: false,
  lastReviewed: "2026-11-01 (placeholder pricing)",

  // Smallest full reroof Titan will quote.
  minimumJob: 6500,

  // Installed price per roofing square [low, high]. Keep the gap tight: it is
  // the normal spread between jobs, not a safety margin (that's `uncertainty`).
  // Price includes: tear-off of one layer,
  // synthetic underlayment, ice & water shield in valleys, new pipe boots
  // and flashing, drip edge, ridge cap, permit, dump trailer and cleanup.
  materials: {
    landmark: {
      name: "CertainTeed Landmark",
      short: "Landmark",
      badge: "Titan standard",
      blurb: "30-year laminated architectural shingle. The system on most Titan roofs.",
      perSquare: [470, 530],
      specs: ["Class 3 impact rated", "130 mph wind rating", "StreakFighter algae resistance"],
      warranty: "Titan workmanship warranty + CertainTeed shingle warranty. SureStart PLUS upgrade available.",
      swatch: { base: "#4A4F57", light: "#6B717A", dark: "#2E3238" }
    },
    landmarkPro: {
      name: "CertainTeed Landmark PRO",
      short: "Landmark PRO",
      badge: "Upgrade",
      blurb: "Heavier, thicker architectural shingle with richer color blends and deeper shadow lines.",
      perSquare: [545, 615],
      specs: ["Heavier-weight shingle", "130 mph wind rating", "Max Def color blends"],
      warranty: "Titan workmanship warranty + CertainTeed shingle warranty. SureStart PLUS upgrade available.",
      swatch: { base: "#5B4A3F", light: "#7C6656", dark: "#3B2F28" }
    },
    climateflex: {
      name: "CertainTeed Landmark ClimateFlex",
      short: "ClimateFlex (Class 4)",
      badge: "Best for hail",
      blurb: "Class 4 impact-resistant shingle built for hail country. Many Texas insurers discount premiums for Class 4 roofs; ask your agent.",
      perSquare: [630, 720],
      specs: ["Class 4 impact rated (UL 2218)", "130 mph wind rating", "Polymer-modified for flexibility"],
      warranty: "Titan workmanship warranty + CertainTeed shingle warranty. SureStart PLUS upgrade available.",
      swatch: { base: "#3D4652", light: "#5A6576", dark: "#262C35" }
    },
    metal: {
      name: "Standing Seam Metal",
      short: "Standing seam metal",
      badge: "Longest life",
      blurb: "Concealed-fastener metal panels. Highest upfront cost, longest service life. Final price confirmed on site.",
      perSquare: [1150, 1400],
      specs: ["40–50+ year service life", "Concealed fasteners", "Wide color range"],
      warranty: "Titan workmanship warranty + panel and finish warranty from the manufacturer.",
      swatch: { base: "#7A8592", light: "#A3ADB8", dark: "#556070" }
    }
  },

  // Roof pitch. `areaFactor` converts flat footprint to sloped roof surface
  // (only used when the roof is NOT measured by satellite). `laborFactor`
  // is the extra cost of working on steeper roofs.
  pitch: {
    low:      { label: "Low",        range: "3–4/12",  rise: 4,  areaFactor: 1.054, laborFactor: 1.00, note: "Easy to walk" },
    standard: { label: "Standard",   range: "5–7/12",  rise: 6,  areaFactor: 1.118, laborFactor: 1.00, note: "Most Houston homes" },
    steep:    { label: "Steep",      range: "8–9/12",  rise: 8.5,areaFactor: 1.225, laborFactor: 1.10, note: "Needs safety gear" },
    vsteep:   { label: "Very steep", range: "10/12+",  rise: 11, areaFactor: 1.357, laborFactor: 1.22, note: "Hard to stand on" }
  },

  // Roof shape. `factor` covers extra waste and labor for hips, valleys,
  // dormers and short runs. `overhang` adds eaves/rakes in manual mode.
  complexity: {
    simple:   { label: "Simple",   desc: "One or two big slopes (gable)",            factor: 0.95, overhang: 1.12 },
    standard: { label: "Standard", desc: "Hips and a few valleys",                    factor: 1.00, overhang: 1.15 },
    complex:  { label: "Complex",  desc: "Many valleys, dormers, multiple rooflines",  factor: 1.12, overhang: 1.18 }
  },

  // Two-story homes cost more to stage, load and protect.
  stories: { 1: 1.00, 2: 1.06 },

  // How much wider the price range gets based on how the roof was measured.
  uncertainty: { satellite: 0.05, satelliteLowQuality: 0.09, manual: 0.12 },

  // Manual mode: average footprint of an attached 2-car garage (sq ft).
  garageFootprint: 440,

  // Manual mode: how much of a 2-story home's living area sits under the roof
  // footprint. 1.65 means footprint = living area / 1.65.
  twoStoryDivisor: 1.65,

  // What it typically costs a contractor to add an item that their quote
  // leaves out. Used to show an apples-to-apples comparison.
  // perSquare = $ per roofing square; flat = $ per job.
  competitorGaps: {
    tearoff: {
      label: "Full tear-off to bare decking",
      ifMissing: "Laying new shingles over old ones hides rotten decking, adds weight and voids most manufacturer warranties.",
      ask: "Will you tear off every existing layer down to the decking?",
      perSquare: 70
    },
    underlayment: {
      label: "Synthetic underlayment",
      ifMissing: "Felt paper absorbs water and typically fails 10+ years before the shingles do.",
      ask: "Is the underlayment synthetic or felt?",
      perSquare: 20
    },
    valleys: {
      label: "Ice & water shield in valleys",
      ifMissing: "Valleys are the #2 leak spot. Texas code doesn't require it, so many quotes skip it.",
      ask: "Do you install ice & water shield in every valley?",
      flat: 350
    },
    boots: {
      label: "All-new pipe boots & flashing",
      ifMissing: "Reused boots crack in the sun and cause slow, hidden leaks.",
      ask: "Are all pipe boots and flashing replaced, or reused if they 'look okay'?",
      flat: 450
    },
    certified: {
      label: "Manufacturer-certified installer",
      ifMissing: "Without certification, extended system warranties like CertainTeed SureStart PLUS aren't available at any price.",
      ask: "Are you certified by the shingle manufacturer, and which warranty will I actually get?",
      flat: 0
    }
  },

  // Text the estimator uses for contact details.
  contact: {
    name: "Colin",
    phoneDisplay: "(936) 827-1550",
    phoneTel: "+19368271550",
    email: "info@titanroofingtx.com"
  },

  // Rough service area check (miles from downtown Houston).
  serviceArea: { lat: 29.76, lng: -95.37, radiusMiles: 110 }
};
