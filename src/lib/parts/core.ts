/**
 * The core menu: the parts listed in Claude's prompt every time (the hand-made
 * core plus these catalog parts, ~140 in all). Everything else in the catalog
 * is found with the search_parts tool. Pick parts that are common and broadly
 * useful; vehicle parts come first because photos of cars are a main use.
 */
export const CORE_MENU_CATALOG: string[] = [
  // Wheels and what they mount on.
  "4600", "30235", "6249", "30157a", "4730",
  "4624c01", "50944c01", "11208c01", "42610c01", "56902c01", "55981c01",
  "3788", "41854", "93587", "24151", "50943",
  // Curved slopes.
  "11477", "50950", "61678", "42022", "15068", "24309", "93606", "44126", "42918", "93604",
  // Wedges and wedge plates (left/right pairs).
  "41769b", "41770b", "6564", "6565", "41767", "41768", "43720", "43721", "47759", "2450",
  // Windscreens.
  "3823", "2437", "57783", "62360", "18973", "30841",
  // Slopes.
  "3038", "3665b", "3676", "4286", "4161", "3939", "4445", "60481a", "85984", "54200", "3041", "3045", "3046", "30363", "60477",
  // Tiles, including grilles.
  "63864", "6636", "4162", "87079", "69729", "26603", "14719", "2412b",
  // Plates.
  "3832", "2445", "4477", "60479", "3958", "3036", "3033", "3028", "3030", "3029", "41539", "2420", "50949",
  // Bricks.
  "3006", "6111", "6112", "2465", "2357", "2356", "14716", "6191", "37352", "3245a",
  // Panels.
  "4865a", "87552",
];
