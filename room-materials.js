/* =====================================================================
   ROOM MATERIAL LIBRARY  —  edit this file to add / tweak materials.
   ---------------------------------------------------------------------
   Each entry is:  "key": { "name": <label shown in the dropdowns>,
                            "a":   [α125, α250, α500, α1k, α2k, α4k] }
   where α is the SABINE ABSORPTION COEFFICIENT (0 = perfectly reflective,
   1 = fully absorbing) at the six octave bands 125 Hz … 4 kHz. Values are
   the pyroomacoustics / architectural-acoustics style tables.

   TO ADD A MATERIAL: copy a line, give it a new unique key + name + six
   numbers. It appears in every wall/floor/ceiling dropdown automatically
   (the UI is built from Object.keys(ROOM_MATERIALS)); no other edits needed.

   NOTE: this is a .js file, not .json, on purpose — the app runs from
   file://, where browsers block fetch() of a sibling .json for security.
   Loaded as a plain <script> before engine-room.js; the object literal
   below the "=" is otherwise valid JSON.
   ===================================================================== */
const ROOM_MATERIALS = {
  "concrete": { "name": "Rough concrete",     "a": [0.02, 0.03, 0.03, 0.03, 0.04, 0.07] },
  "painted":  { "name": "Painted concrete",   "a": [0.01, 0.01, 0.02, 0.02, 0.02, 0.03] },
  "brick":    { "name": "Unglazed brick",     "a": [0.03, 0.03, 0.03, 0.04, 0.05, 0.07] },
  "plaster":  { "name": "Plaster on lath",    "a": [0.14, 0.10, 0.06, 0.05, 0.04, 0.03] },
  "gypsum":   { "name": "Gypsum board",       "a": [0.29, 0.10, 0.05, 0.04, 0.07, 0.09] },
  "glass":    { "name": "Glass (large pane)", "a": [0.18, 0.06, 0.04, 0.03, 0.02, 0.02] },
  "wood":     { "name": "Wooden floor",       "a": [0.15, 0.11, 0.10, 0.07, 0.06, 0.07] },
  "marble":   { "name": "Marble / tile",      "a": [0.01, 0.01, 0.01, 0.01, 0.02, 0.02] },
  "carpet":   { "name": "Heavy carpet",       "a": [0.02, 0.06, 0.14, 0.37, 0.60, 0.65] },
  "curtain":  { "name": "Heavy curtain",      "a": [0.14, 0.35, 0.55, 0.72, 0.70, 0.65] },
  "foam":     { "name": "Acoustic foam 2in",  "a": [0.15, 0.30, 0.75, 0.85, 0.95, 0.90] },
  "audience": { "name": "Audience (seated)",  "a": [0.39, 0.57, 0.80, 0.94, 0.92, 0.87] }
};
