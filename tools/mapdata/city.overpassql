[out:json][timeout:120];
(
  way["highway"~"^(trunk|primary|secondary|tertiary|residential|unclassified|living_street|pedestrian|trunk_link|primary_link|secondary_link|tertiary_link)$"](47.6065,-122.3575,47.6300,-122.3295);
  way["building"](47.6065,-122.3575,47.6300,-122.3295);
  way["natural"="water"](47.6065,-122.3575,47.6320,-122.3295);
  relation["natural"="water"](47.6065,-122.3575,47.6320,-122.3295);
  way["natural"="coastline"](47.6040,-122.3700,47.6320,-122.3295);
  way["leisure"="park"](47.6065,-122.3575,47.6300,-122.3295);
  way["railway"~"^(tram|monorail)$"](47.6065,-122.3575,47.6300,-122.3295);
);
out body geom;
